terraform {
  required_version = ">= 1.1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.85"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # Uncomment for remote state (recommended for production)
  # backend "azurerm" {
  #   resource_group_name  = "terraform-state-rg"
  #   storage_account_name = "yourtfstateaccount"
  #   container_name       = "tfstate"
  #   key                  = "mapping-app.tfstate"
  # }
}

provider "azurerm" {
  features {}
}
