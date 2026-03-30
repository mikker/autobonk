# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Built-in blind-peering integration (opt-in via Manager/Context options).
- `ContextNetwork` for app-level Hyperswarm and wakeup ownership.

### Changed

- `Manager` now reuses one shared transport runtime across managed contexts.
- `Context` now joins replication through `ContextNetwork` instead of owning its own swarm setup.
- Blind peering is configured from options and owned by the context lifecycle.

## [1.0.0] - 2026-01-15

### Added

- Initial release.
