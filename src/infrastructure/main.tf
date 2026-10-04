# The chess system.
#
# Everything chess owns on a shared environment: its namespace, its network
# policies and a web server publishing ../web. The cluster, the ingress
# controller and TLS issuance all belong to the `infrastructure` repository and
# are read from its state below — nothing it creates is declared again here.
#
# State key: chess-app.tfstate, in the environment's shared state account.

data "terraform_remote_state" "infra" {
  backend = "azurerm"

  config = {
    resource_group_name  = var.platform_state_resource_group_name
    storage_account_name = var.platform_state_storage_account_name
    container_name       = var.platform_state_container_name
    key                  = var.platform_state_key
    use_azuread_auth     = true
  }
}

locals {
  infra = data.terraform_remote_state.infra.outputs

  name = "chess-web"

  # Our hostname, derived from the platform's base hostname rather than written
  # down: a non-prod environment names itself from its ingress IP, which changes
  # on every rebuild.
  web_hostname = "chess-${local.infra.base_hostname}"

  labels = {
    "app.kubernetes.io/name"       = "chess"
    "app.kubernetes.io/instance"   = var.env_name
    "app.kubernetes.io/component"  = "web"
    "app.kubernetes.io/managed-by" = "terraform"
  }

  selector_labels = {
    "app.kubernetes.io/name"      = "chess"
    "app.kubernetes.io/component" = "web"
  }

  # The site itself. Every file under ../web is published through a ConfigMap
  # mounted as nginx's document root, so there is no image to build and a
  # deployment is `terraform apply`. A ConfigMap holds 1 MiB at most — if the
  # site outgrows that (larger piece images, say) it needs an image of its own.
  web_root  = "${path.module}/../web"
  web_files = fileset(local.web_root, "**")

  # Text goes in `data`, everything else in `binary_data`, which is base64.
  text_extensions = ["html", "js", "json", "svg", "css", "txt", "map"]
  text_files = toset([
    for f in local.web_files : f
    if contains(local.text_extensions, lower(element(split(".", f), length(split(".", f)) - 1)))
  ])
  binary_files = setsubtract(local.web_files, local.text_files)

  # A ConfigMap key cannot contain "/", so each key is the flattened path and
  # the volume's `items` map it back to the real one.
  web_keys = { for f in local.web_files : f => replace(f, "/", "__") }

  # Changes whenever any file does, which rolls the pods so a deploy is visible
  # immediately rather than whenever the kubelet next syncs the volume.
  web_checksum = sha256(join("", [for f in sort(local.web_files) : filesha256("${local.web_root}/${f}")]))
}

# ---------------------------------------------------------------------------
# Namespace
# ---------------------------------------------------------------------------

resource "kubernetes_namespace_v1" "chess" {
  metadata {
    name   = var.namespace
    labels = local.labels
  }
}

# ---------------------------------------------------------------------------
# Network policies
#
# The platform's default-deny covers its own namespace only. This one is ours,
# and a namespace with no policy at all is reachable from every pod on the
# cluster, including every other system sharing it.
# ---------------------------------------------------------------------------

resource "kubernetes_network_policy_v1" "default_deny" {
  metadata {
    name      = "default-deny-ingress"
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]
  }
}

resource "kubernetes_network_policy_v1" "allow_ingress_nginx" {
  metadata {
    name      = "allow-ingress-nginx"
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      from {
        # `kubernetes.io/metadata.name` is set by Kubernetes itself. A selector
        # on a label somebody applies fails open if the label is ever missing.
        namespace_selector {
          match_labels = { "kubernetes.io/metadata.name" = "ingress-nginx" }
        }
      }

      ports {
        port     = var.container_port
        protocol = "TCP"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Web server
# ---------------------------------------------------------------------------

resource "kubernetes_config_map_v1" "web_content" {
  metadata {
    name      = "${local.name}-content"
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels
  }

  data        = { for f in local.text_files : local.web_keys[f] => file("${local.web_root}/${f}") }
  binary_data = { for f in local.binary_files : local.web_keys[f] => filebase64("${local.web_root}/${f}") }
}

resource "kubernetes_deployment_v1" "web" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels
  }

  spec {
    replicas = var.replica_count

    selector {
      match_labels = local.selector_labels
    }

    template {
      metadata {
        labels = local.labels

        annotations = {
          "chess/content-checksum" = local.web_checksum
        }
      }

      spec {
        automount_service_account_token = false

        security_context {
          run_as_non_root = true
          run_as_user     = 101
          run_as_group    = 101

          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          name  = "nginx"
          image = var.web_image

          port {
            name           = "http"
            container_port = var.container_port
          }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true

            capabilities {
              drop = ["ALL"]
            }
          }

          resources {
            requests = {
              cpu    = "10m"
              memory = "32Mi"
            }
            limits = {
              memory = "64Mi"
            }
          }

          readiness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            period_seconds = 10
          }

          liveness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            period_seconds = 30
          }

          volume_mount {
            name       = "content"
            mount_path = "/usr/share/nginx/html"
            read_only  = true
          }

          # nginx writes its pid file and temp files here; the root filesystem
          # is read-only.
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }
        }

        volume {
          name = "content"

          config_map {
            name = kubernetes_config_map_v1.web_content.metadata[0].name

            dynamic "items" {
              for_each = local.web_keys

              content {
                key  = items.value
                path = items.key
              }
            }
          }
        }

        volume {
          name = "tmp"
          empty_dir {}
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "web" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels
  }

  spec {
    selector = local.selector_labels

    port {
      name        = "http"
      port        = 80
      target_port = "http"
    }
  }
}

resource "kubernetes_ingress_v1" "web" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.chess.metadata[0].name
    labels    = local.labels

    annotations = {
      "nginx.ingress.kubernetes.io/ssl-redirect"       = "true"
      "nginx.ingress.kubernetes.io/force-ssl-redirect" = "true"

      # Read from the platform rather than hardcoded: non-prod issues from the
      # environment's own CA, prod from Let's Encrypt.
      "cert-manager.io/cluster-issuer" = local.infra.tls_issuer
    }
  }

  spec {
    ingress_class_name = "nginx"

    tls {
      hosts       = [local.web_hostname]
      secret_name = "${local.name}-tls"
    }

    rule {
      host = local.web_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.web.metadata[0].name

              port {
                name = "http"
              }
            }
          }
        }
      }
    }
  }

  # The certificate is issued asynchronously; do not hold the apply on the
  # load balancer status, which the shared controller already owns.
  wait_for_load_balancer = false
}
