# Changelog

All notable changes to the Sari-Sari Store Management System are documented here.

This project does not currently use Git tags, so versions below are inferred from the Git commit history and the current `package.json` version. The current release is treated as `1.5.1`.

## [1.5.1] - 2026-06-18

### What's New
- Mobile Cart Optimization: Redesigned the cart summary into a responsive grid (2+1 layout) to prevent cramped text on small screens.
- Enhanced Cart Viewport Fit: Fixed the cart drawer positioning and width on mobile to ensure it anchors correctly within the viewport without being cut off.

### Changed
- Disabled automatic search focus when entering the Sales tab to prevent the keyboard from popping up unexpectedly on mobile.
- Refined cart quantity controls on mobile by removing fixed widths that were causing layout breakage in narrow tables.

## [1.5.0] - 2026-06-18

### What's New
- Responsive Status Metrics: Implemented an adaptive card system that displays full text on PC and compact icons on mobile for both Dashboard and Inventory pages.
- High-Density Grid: Optimized the mobile layout to show 4 status metrics per row (up from 2), significantly increasing data visibility on small screens.
- Mobile Button Optimization: Transformed large inventory management buttons into sleek, icon-only circular buttons on mobile devices.

### Changed
- Improved mobile viewport containment with `overflow-x: hidden` to eliminate horizontal scrolling.
- Refined typography and spacing across all mobile metric cards for a cleaner, modern look.
- Synchronized visual styles between the Dashboard and Inventory summary sections for consistency.

## [1.4.0] - 2026-06-17

### What's New
- Consolidated Reports functionality into the Dashboard to provide a unified business overview in a single view.
- Added an "Analytics & Long-term Insights" section to the Dashboard featuring weekly performance bars, monthly trend lines, and category revenue breakdowns.
- Separated Monthly Sales metrics into three distinct cards for Product Sales, eLoad Sales, and GCash Sales.

### Changed
- Removed the standalone Reports tab from the navigation and account dropdown.
- Restructured the Inventory status grid on the Inventory page into a single horizontal row for better space utilization.
- Unified data retrieval logic in `src/db.js` to support the consolidated Dashboard.

## [1.3.0] - 2026-06-16

### What's New
- Moved Category and Supplier management from Settings to the Inventory tab for centralized product management.
- Added a global system footer displaying the developer's name and the current system version.

### Changed
- Integrated Category and Supplier management via modals with dedicated buttons in the inventory header.
- Optimized inventory management buttons for better mobile responsiveness using dynamic sizing and padding.
- Improved server-side version management to dynamically serve the version number across all views.

## [1.2.0] - 2026-06-15

### Changed
- Moved the eLoad setting to the eLoad tab for better and faster navigation.
- Updated the display of logs Tabs and Queue from eLoad Tabs.
- The Logs tabs now display the load value instead of the selling price.
- Fixed the Queue from eLoad not displaying the selling price.

## [1.0.0] - 2026-06-13

### What's New
- Added configurable eLoad network management so supported networks can be maintained from the app instead of being fixed in the interface.
- Added edit support for eLoad promos.
- Added Docker support for production-style hosting with `Dockerfile` and `docker-compose.yml`.
- Improved the dashboard and eLoad interface for clearer day-to-day operation.
- Added improved logs access and optimized the logs interface.

### Changed
- Polished the current cart experience, especially in mobile mode.
- Improved role and access behavior around protected sections.
- Refined the eLoad workflow and general user experience.
- Persisted database updates more reliably.

### Fixed
- Fixed active color synchronization for the current cart button in mobile mode.
- Fixed database save behavior when updating records.

## [0.9.0] - 2026-05-27

### What's New
- Overhauled the Sales, eLoad, and Inventory user interfaces.
- Removed the PIN verification system in favor of username/password authentication.
- Added user preference persistence through local storage.
- Added a Windows scale setting under Appearance preferences.
- Added seeded user credentials for easier local testing.

### Changed
- Improved Inventory readability and navigation.
- Limited standard users from seeing detailed inventory information.
- Reduced dashboard refresh timing to make operational data feel more current.
- Reworked Appearance settings layout and styling.
- Improved mobile statuses, tabs, the current cart panel, and overall responsive behavior.
- Updated project documentation to match the newer workflow.

### Fixed
- Fixed notification behavior.
- Improved role/access handling after the PIN-less authentication update.

## [0.8.0] - 2026-04-24

### What's New
- Added dashboard auto-refresh polling.
- Added live dashboard overview refresh every 10 seconds.
- Added sales chart refresh every 15 seconds.
- Added better syncing for pending eLoad and GCash request cards across accounts.
- Added Supplier CRUD management in Settings.

### Changed
- Optimized dashboard data display and corrected dashboard calculations.
- Moved the desktop navigation to a top bar while retaining the sidebar for the mobile drawer.
- Improved the dashboard mobile layout.
- Continued broad UI/UX optimization across major screens.

### Fixed
- Fixed dashboard chart behavior.
- Fixed logs display issues.
- Fixed account tab behavior.

## [0.7.0] - 2026-04-21

### What's New
- Added request-based transaction handling for eLoad.
- Added improved quick buttons for faster sales entry.
- Added logs tab for operational tracking.
- Added role-based access controls.
- Added inventory status printing.

### Changed
- Removed unnecessary interface elements and simplified workflows.
- Optimized early user experience across the dashboard and sales flow.
- Improved account management tab behavior.

## [0.1.0] - 2026-03-22

### What's New
- Initial project import.
- Established the Express, EJS, Bootstrap, and SQLite application foundation.
- Added the first version of the Sari-Sari Store Management System structure.

## Links

- Project overview: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
- Setup and usage: [README.md](README.md)
