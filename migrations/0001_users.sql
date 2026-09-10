-- Clerk owns authentication. Internal IDs remain stable across profile updates.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  clerk_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100)
);
