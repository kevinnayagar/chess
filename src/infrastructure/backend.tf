# Partial backend: the state account and key are supplied with -backend-config at
# init time, so no environment-specific name is committed.
#
# The account belongs to the infrastructure repository — one per environment,
# `stpgshared<env>`. The key is ours:
#
#   terraform init -reconfigure \
#     -backend-config="resource_group_name=rg-shared-<env>" \
#     -backend-config="storage_account_name=stpgshared<env>" \
#     -backend-config="container_name=tfstate" \
#     -backend-config="key=chess-app.tfstate" \
#     -backend-config="use_azuread_auth=true"
#
# `use_azuread_auth` is not optional: the state account disables shared keys.
#
# This state dies with the environment: the infrastructure repository's
# `destroy-env.sh` deletes the account. Nothing here outlives the cluster, so
# there is nothing left behind when it does.

terraform {
  backend "azurerm" {}
}
