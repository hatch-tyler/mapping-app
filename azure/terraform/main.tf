# --- Locals ---

locals {
  # Use custom domain if provided, otherwise use Azure DNS label FQDN
  effective_domain  = var.domain_name != "" ? var.domain_name : azurerm_public_ip.main.fqdn
  use_custom_domain = var.domain_name != ""
}

# --- Random Passwords ---

resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!@#$%^&*()-_=+"
}

resource "random_password" "secret_key" {
  length  = 64
  special = false
}

resource "random_password" "initial_admin_password" {
  length           = 16
  special          = true
  override_special = "!@#$%^&*"
}

# --- Resource Group ---

resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-${var.environment}-rg"
  location = var.location

  tags = merge(var.tags, {
    project     = var.project_name
    environment = var.environment
  })
}

# --- Networking ---

resource "azurerm_virtual_network" "main" {
  name                = "${var.project_name}-${var.environment}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_subnet" "main" {
  name                 = "${var.project_name}-${var.environment}-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

# --- Network Security Group ---

resource "azurerm_network_security_group" "main" {
  name                = "${var.project_name}-${var.environment}-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "SSH"
    priority                   = 1000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.ssh_allowed_cidr
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTP"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTPS"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = azurerm_resource_group.main.tags
}

# --- Public IP ---

resource "azurerm_public_ip" "main" {
  name                = "${var.project_name}-${var.environment}-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.dns_label

  tags = azurerm_resource_group.main.tags
}

# --- Network Interface ---

resource "azurerm_network_interface" "main" {
  name                = "${var.project_name}-${var.environment}-nic"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.main.id
  }

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_network_interface_security_group_association" "main" {
  network_interface_id      = azurerm_network_interface.main.id
  network_security_group_id = azurerm_network_security_group.main.id
}

# --- Managed Data Disk ---

resource "azurerm_managed_disk" "data" {
  name                 = "${var.project_name}-${var.environment}-data-disk"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  storage_account_type = "Premium_LRS"
  create_option        = "Empty"
  disk_size_gb         = var.data_disk_size_gb

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_virtual_machine_data_disk_attachment" "data" {
  managed_disk_id    = azurerm_managed_disk.data.id
  virtual_machine_id = azurerm_linux_virtual_machine.main.id
  lun                = 0
  caching            = "ReadWrite"
}

# --- Off-VM Backup Storage (Azure Blob) ---
#
# Backups are written locally to /mnt/data/backups (the managed data
# disk) and — when enable_backup_blob_storage is true — replicated to a
# private blob container so they survive loss of that disk. The VM's
# system-assigned managed identity authenticates against the storage
# account, so no keys live in the .env file.

resource "random_string" "backup_storage_suffix" {
  count   = var.enable_backup_blob_storage && var.backup_storage_account_name == "" ? 1 : 0
  length  = 4
  upper   = false
  special = false
  numeric = true
}

locals {
  # Storage account names are globally unique, 3-24 lowercase
  # alphanumerics. We strip non-alphanumerics from project_name and
  # environment, then append a random suffix unless the caller supplied
  # an explicit name.
  backup_storage_account_name = (
    var.enable_backup_blob_storage
    ? (
      var.backup_storage_account_name != ""
      ? var.backup_storage_account_name
      : substr(
        "${replace(lower(var.project_name), "/[^a-z0-9]/", "")}${replace(lower(var.environment), "/[^a-z0-9]/", "")}bk${random_string.backup_storage_suffix[0].result}",
        0,
        24,
      )
    )
    : ""
  )
}

resource "azurerm_storage_account" "backups" {
  count                    = var.enable_backup_blob_storage ? 1 : 0
  name                     = local.backup_storage_account_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = var.backup_storage_replication_type
  # Shared keys remain enabled because the azurerm provider's
  # azurerm_storage_container resource reaches the data plane via the
  # account key. The runtime path (the backend container) uses the
  # VM's managed identity, so keys are never embedded in app config —
  # they stay an admin-only escape hatch for Terraform.
  shared_access_key_enabled = true
  # Backup data is sensitive (DB dump, uploads); refuse anonymous reads.
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"

  blob_properties {
    versioning_enabled = false
  }

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_storage_container" "backups" {
  count                 = var.enable_backup_blob_storage ? 1 : 0
  name                  = var.backup_storage_container_name
  storage_account_name  = azurerm_storage_account.backups[0].name
  container_access_type = "private"
}

# User-assigned identity for the VM. Using user-assigned (rather than
# system-assigned) lets the role assignment reference a stable
# principal_id at plan time, which avoids the chicken-and-egg between
# adding identity to the VM and adding a role assignment that
# depends on it. The identity outlives any single VM instance.
resource "azurerm_user_assigned_identity" "vm" {
  count               = var.enable_backup_blob_storage ? 1 : 0
  name                = "${var.project_name}-${var.environment}-vm-identity"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_role_assignment" "vm_backup_blob_writer" {
  count                = var.enable_backup_blob_storage ? 1 : 0
  scope                = azurerm_storage_account.backups[0].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.vm[0].principal_id
}

# --- Virtual Machine ---

resource "azurerm_linux_virtual_machine" "main" {
  name                = "${var.project_name}-${var.environment}-vm"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.main.id,
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  # User-assigned managed identity. The backend container uses it via
  # IMDS (DefaultAzureCredential) to authenticate against the backup
  # storage account without any secret in the .env file. The block is
  # only present when blob backups are enabled.
  dynamic "identity" {
    for_each = var.enable_backup_blob_storage ? [1] : []
    content {
      type         = "UserAssigned"
      identity_ids = [azurerm_user_assigned_identity.vm[0].id]
    }
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 30
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/../scripts/cloud-init.yml", {
    admin_username          = var.admin_username
    domain_name             = local.effective_domain
    certbot_email           = var.certbot_email
    db_name                 = var.db_name
    db_username             = var.db_username
    db_password             = random_password.db_password.result
    secret_key              = random_password.secret_key.result
    initial_admin_email     = var.initial_admin_email
    initial_admin_password  = random_password.initial_admin_password.result
    initial_admin_full_name = var.initial_admin_full_name
    upload_max_size_mb      = var.upload_max_size_mb
    url_scheme              = local.use_custom_domain ? "https" : "http"
    azure_backup_container = (
      var.enable_backup_blob_storage ? var.backup_storage_container_name : ""
    )
    azure_storage_account_url = (
      var.enable_backup_blob_storage
      ? "https://${local.backup_storage_account_name}.blob.core.windows.net"
      : ""
    )
  }))

  tags = azurerm_resource_group.main.tags

  # cloud-init only runs at first boot; once the VM is provisioned the
  # custom_data field is informational. Without this block, any edit to
  # cloud-init.yml or interpolated variables (db_password, etc.) would
  # force VM replacement (destroy + recreate), wiping the OS disk
  # including /etc/fstab, certbot install, and any post-provision state.
  # In-place updates like vm_size resize are unaffected.
  lifecycle {
    ignore_changes = [custom_data]
  }
}
