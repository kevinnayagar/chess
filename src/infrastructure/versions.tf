terraform {
  required_version = "~> 1.15"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.32"
    }
  }
}

# Used only to read the platform's state and the cluster's credentials. This
# stage creates no Azure resource.
provider "azurerm" {
  subscription_id     = var.subscription_id
  storage_use_azuread = true

  features {}
}

# The cluster's admin kubeconfig. The cluster already exists — the
# infrastructure repository created it — so these values are known at plan time
# from a data source.
data "azurerm_kubernetes_cluster" "this" {
  name                = local.infra.cluster_name
  resource_group_name = local.infra.resource_group_name
}

locals {
  kube = data.azurerm_kubernetes_cluster.this.kube_admin_config[0]
}

provider "kubernetes" {
  host                   = local.kube.host
  cluster_ca_certificate = base64decode(local.kube.cluster_ca_certificate)
  client_certificate     = base64decode(local.kube.client_certificate)
  client_key             = base64decode(local.kube.client_key)
}
