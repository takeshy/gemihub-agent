variable "project_id" {
  type    = string
  default = "geminihub-486523"
}
variable "app_image" {
  type = string
  validation {
    condition     = startswith(var.app_image, "asia-northeast1-docker.pkg.dev/")
    error_message = "Use an Artifact Registry image in asia-northeast1."
  }
}
variable "vertex_model" { type = string }
locals {
  name  = "gemihub-dev"
  hosts = ["dev.gemihub.net", "admin.dev.gemihub.net", "shop.dev.gemihub.net"]
  config = {
    project = var.project_id
    image   = var.app_image
    model   = var.vertex_model
    secrets = {}
  }
}
resource "google_project_service" "dev" {
  for_each           = toset(["compute.googleapis.com", "firestore.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "aiplatform.googleapis.com", "dns.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}
resource "google_service_account" "runtime" {
  account_id   = local.name
  display_name = "GemiHub isolated development runtime"
}
resource "google_service_account" "build" {
  account_id   = "gemihub-dev-build"
  display_name = "GemiHub development image builder"
}
resource "google_firestore_database" "app" {
  name                    = local.name
  location_id             = "asia-northeast1"
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.dev]
  lifecycle { prevent_destroy = true }
}
resource "google_project_iam_member" "database" {
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
  project = var.project_id
  condition {
    title      = "gemihub_dev_database_only"
    expression = "resource.name == 'projects/${var.project_id}/databases/${local.name}'"
  }
}
resource "google_project_iam_member" "vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}
resource "google_storage_bucket" "files" {
  name                        = "${var.project_id}-${local.name}-files"
  location                    = "ASIA-NORTHEAST1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  depends_on                  = [google_project_service.dev]
  lifecycle { prevent_destroy = true }
}
resource "google_storage_bucket_iam_member" "files" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
resource "google_storage_bucket" "build" {
  name                        = "${var.project_id}-${local.name}-build-source"
  location                    = "ASIA-NORTHEAST1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  depends_on                  = [google_project_service.dev]
  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
}
resource "google_storage_bucket_iam_member" "build" {
  bucket = google_storage_bucket.build.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}
resource "google_artifact_registry_repository" "app" {
  location      = "asia-northeast1"
  repository_id = local.name
  format        = "DOCKER"
  depends_on    = [google_project_service.dev]
}
resource "google_artifact_registry_repository_iam_member" "reader" {
  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.runtime.email}"
}
resource "google_artifact_registry_repository_iam_member" "writer" {
  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}
resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}
resource "google_secret_manager_secret" "runtime" {
  secret_id = "gemihub-dev-runtime"
  replication {
    auto {}
  }
  depends_on = [google_project_service.dev]
  lifecycle { prevent_destroy = true }
}
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each   = toset(["gemihub-dev-runtime"])
  secret_id  = each.value
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.runtime.email}"
  depends_on = [google_secret_manager_secret.runtime]
}
resource "google_compute_address" "dev" {
  name         = local.name
  region       = "asia-northeast1"
  network_tier = "STANDARD"
}
resource "google_compute_network" "dev" {
  name                    = local.name
  auto_create_subnetworks = false
}
resource "google_compute_subnetwork" "dev" {
  name          = local.name
  region        = "asia-northeast1"
  network       = google_compute_network.dev.id
  ip_cidr_range = "10.250.0.0/24"
}
resource "google_compute_firewall" "web" {
  name          = "gemihub-dev-web"
  network       = google_compute_network.dev.name
  target_tags   = [local.name]
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}
resource "google_compute_firewall" "iap" {
  name          = "gemihub-dev-iap"
  network       = google_compute_network.dev.name
  target_tags   = [local.name]
  source_ranges = ["35.235.240.0/20"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
resource "google_compute_instance" "dev" {
  name         = local.name
  machine_type = "e2-small"
  zone         = "asia-northeast1-b"
  tags         = [local.name]
  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 40
      type  = "pd-standard"
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.dev.id
    access_config {
      nat_ip       = google_compute_address.dev.address
      network_tier = "STANDARD"
    }
  }
  service_account {
    email  = google_service_account.runtime.email
    scopes = ["cloud-platform"]
  }
  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
    gemihub-dev-config     = jsonencode(local.config)
    gemihub-dev-compose    = base64encode(file("${path.module}/compose.yaml"))
    gemihub-dev-caddy      = base64encode(file("${path.module}/Caddyfile"))
    gemihub-dev-runner     = base64encode(file("${path.module}/run.py"))
  }
  metadata_startup_script = file("${path.module}/startup.sh")
  depends_on              = [google_project_service.dev, google_secret_manager_secret_iam_member.runtime, google_project_iam_member.database, google_storage_bucket_iam_member.files]
  lifecycle { prevent_destroy = true }
}
resource "google_dns_record_set" "dev" {
  for_each     = toset(local.hosts)
  managed_zone = "gemihub-net"
  name         = "${each.value}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.dev.address]
}
output "ip_address" { value = google_compute_address.dev.address }
output "urls" { value = [for host in local.hosts : "https://${host}/"] }
