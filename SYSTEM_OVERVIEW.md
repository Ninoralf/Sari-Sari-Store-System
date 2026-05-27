# Sari-Sari Store Management System - Project Overview

This document serves as a comprehensive guide for developers and AI agents to understand the purpose, architecture, functionality, and specific business rules of this application.

## 1. Core Purpose
A specialized Point-of-Sale (POS) and Inventory Management System designed for Sari-Sari stores (neighborhood convenience stores in the Philippines). It handles standard retail sales, inventory tracking, and specialized digital services (eLoad/GCash).

## 2. Technical Stack
- **Backend:** Node.js (Express.js)
- **Frontend:** EJS (Embedded JavaScript) Templates with Bootstrap 5
- **Database:** SQLite (using the native `node:sqlite` module)
- **Security:** Session-based authentication, CSRF protection, and role-based access control (Admin vs. User).

## 3. Key Modules & Functions

### **A. Sales (POS)**
- **UI Design:** Features a modern, card-based interface with a fixed search bar and horizontally scrollable category filters.
- **Cart System:** Supports adding multiple items, adjusting quantities, and combining physical goods with digital service requests in one transaction.
- **Sales Logging:** Every sale generates a unique transaction code and records the employee/admin who performed the sale.

### **B. Inventory Management**
- **UI Design:** Uses a modern, floating modal panel for adding items, keeping the main list focused and clean.
- **Manual Stock Labeling (Crucial Rule):** Unlike traditional systems that track exact numerical quantities, this system uses **Manual Status Labels**:
    - `In Stock`: Item is available for sale (Green badge).
    - `Low Stock`: Item needs restocking soon (Yellow badge).
    - `Out of Stock`: Item is unavailable and hidden/disabled in the Sales UI (Red badge).
- **Organization:** Items are grouped by Categories and linked to specific Suppliers.

### **C. Digital Services (eLoad & GCash)**
- **Optimized Experience:** Features a high-performance tabbed interface with a hidden-by-default toggleable queue.
- **Guided Workflow:** Includes a Step-by-Step visual guide (1, 2, 3, 4) designed for non-technical staff.
- **Smart Formatting:** Automatic phone number formatting and tactile toggles for GCash flow (Cash In/Out).
- **Fulfillment:** Built-in "Fulfill" workflow with reference number tracking and staff notes.

### **D. User Management**
- **Simplified Security:** The system uses a **PIN-less verification** model. Access is granted via Username and Password only.
- **Admin Authority:**
    - Admins can create and manage all user accounts.
    - **Password Visibility:** Admins can view the plain-text passwords of all users via a toggleable "eye" icon in the management dashboard.
    - **Reset Authority:** Admins can reset any user's password at any time.

### **E. Settings & Tools**
- **Store Profile:** Customizable store name, address, and contact info.
- **Data Portability:** Export inventory and sales data to CSV.
- **System Maintenance:** Database backup and reset-to-defaults functionality.

## 4. Business Rules & Logic
1. **Authentication:** All routes except `/login` require an active session.
2. **Authorization:** Only accounts with the `Admin` role can access Inventory Management, User Accounts, Reports, and System Settings.
3. **Transaction Integrity:** Sales cannot be completed with an empty cart. Inventory status is updated immediately upon adding/removing items in the management module.
4. **Visibility:** Only items marked as `In Stock` or `Low Stock` are visible in the Quick Entry Sales grid.

## 5. Directory Structure
- `/src`: Main application logic and database operations (`db.js`, `server.js`).
- `/views`: UI templates and partials.
- `/public`: Static assets (CSS, images).
- `/data`: Storage for the SQLite database file (`store.db`).
- `/scripts`: Utility and verification scripts.
