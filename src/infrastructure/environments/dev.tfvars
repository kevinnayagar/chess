# chess on the dev environment.
#
# The environment itself — the cluster, the ingress, TLS — is described by the
# `infrastructure` repository's own environments/dev.tfvars.
#
# subscription_id is deliberately absent: it is supplied on the command line or
# via TF_VAR_subscription_id, so no subscription identifier is committed.

env_name = "dev"

# Where to find the environment's Terraform state, to read the platform's outputs.
platform_state_resource_group_name  = "rg-shared-dev"
platform_state_storage_account_name = "stpgshareddev"

replica_count = 1
