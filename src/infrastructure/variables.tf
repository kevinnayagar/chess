variable "subscription_id" {
  description = "The Azure subscription the environment lives in. Supplied on the command line or via TF_VAR_subscription_id, never committed."
  type        = string
}

variable "env_name" {
  description = "The environment this system is deployed onto. Must match an environment the infrastructure repository has created."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+$", var.env_name)) && length(var.env_name) <= 12
    error_message = "env_name must be lowercase alphanumeric and 12 characters or fewer, matching the constraint the platform's bootstrap enforces."
  }
}

# ---------------------------------------------------------------------------
# The platform's state
#
# Everything this stage needs from the shared environment is read through a
# terraform_remote_state data source rather than copied in, so these values
# locate the state blob and nothing more.
# ---------------------------------------------------------------------------

variable "platform_state_resource_group_name" {
  description = "Resource group holding the environment's state account: rg-shared-<env>."
  type        = string
}

variable "platform_state_storage_account_name" {
  description = "The environment's state account: stpgshared<env>."
  type        = string
}

variable "platform_state_container_name" {
  description = "Container holding the state blobs."
  type        = string
  default     = "tfstate"
}

variable "platform_state_key" {
  description = "Blob key of the platform stage's state, in the infrastructure repository."
  type        = string
  default     = "platform.tfstate"
}

# ---------------------------------------------------------------------------
# Kubernetes
# ---------------------------------------------------------------------------

variable "namespace" {
  description = "The namespace the chess system runs in. Created by this stage: the shared platform creates no namespace per system."
  type        = string
  default     = "chess"
}

variable "web_image" {
  description = "The web server image. The unprivileged nginx build, which runs as a non-root user and listens on 8080. Pinned to a patch version, never `latest`."
  type        = string
  default     = "nginxinc/nginx-unprivileged:1.29.8-alpine"
}

variable "container_port" {
  description = "Port the web server listens on, and therefore the only port the ingress controller is allowed to reach it on. The network policy and the container must agree, so it is declared once."
  type        = number
  default     = 8080
}

variable "replica_count" {
  description = "Web server replicas."
  type        = number
  default     = 1
}
