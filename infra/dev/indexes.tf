# Same application indexes and retention rules as the shop runtime.
resource "google_firestore_field" "public_ai_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_public_ai"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}
# TTL deletion can lag; application queries independently enforce the same 90-day window.
resource "google_firestore_field" "shop_log_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_log_events"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_index" "customer_activity" {
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  fields {
    field_path = "customerKey"
    order      = "ASCENDING"
  }
  fields {
    field_path = "at"
    order      = "DESCENDING"
  }
}

locals {
  # Every optional equality/array filter combination followed by the timestamp range/order.
  # Mask 1 (customerKey alone) is already managed by customer_activity above.
  log_search_indexes = {
    for mask in range(2, 16) : tostring(mask) => [
      for bit, field in ["customerKey", "kind", "ok", "references"] : field
      if floor(mask / pow(2, bit)) % 2 == 1
    ]
  }
}

resource "google_firestore_index" "log_search" {
  for_each    = local.log_search_indexes
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  dynamic "fields" {
    for_each = each.value
    content {
      field_path   = fields.value
      order        = fields.value == "references" ? null : "ASCENDING"
      array_config = fields.value == "references" ? "CONTAINS" : null
    }
  }
  fields {
    field_path = "at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_field" "article_visitor_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_article_visitors"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_field" "daily_visitor_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_daily_visitors"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_index" "post_views" {
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  fields {
    field_path = "postId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "at"
    order      = "ASCENDING"
  }
}
