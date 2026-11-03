# Identity Service (`identity-service`)

> Enterprise Multi-Tenant Identity & Access Management Service built with **Node.js, Express, TypeScript, PostgreSQL, and React**, adhering to **Vertical Slice Architecture**, **Hexagonal Architecture (DDD)**, and strict domain-driven testability.

---

## 🎨 Architectural Highlights

* **Vertical Slice Architecture:** Features are organized by self-contained domain capabilities (Command Slices for writes, Query Slices for reads) rather than horizontal technical layers.
* **Hexagonal Architecture / DDD:** Business invariants (Value Objects, Aggregate Roots) are completely isolated from web frameworks, ORMs, and external drivers.
* **Multi-Tenant Isolation:** First-class support for tenant-scoped operations, ensuring data segregation across all persistence and caching boundaries.
* **Comprehensive Testing Pyramid:** Enforces quality through Unit tests (Domain/Application), Integration tests (Express/DB), Acceptance tests (BDD Gherkin), and End-to-End tests (React UI).

---

## 📂 Repository Structure

```text
identity-service/
├── .agent/                                   # Agent governance, rules, templates & memory
│   ├── TREE.txt                              # Technical blueprint of the repository
│   ├── memory/                               # Private PRD & Traceability Matrix
│   ├── epics/                                # Feature Epics & User Stories
│   ├── rules/                                # Architectural & Testing Golden Rules
│   └── templates/                            # Standard ADR, Epic, Story, and Task templates
├── docs/                                     # Public technical documentation
│   ├── ARCHITECTURE.md                       # Formal architecture design document
│   ├── PRD.md                                # Product Requirement Document
│   └── adr/                                  # Architectural Decision Records (0001, 0002, 0003)
├── src/
│   └── contexts/
│       └── identity/                         # Bounded Context: Identity
│           ├── domain/                       # Core Domain: Entities, Value Objects, Domain Exceptions
│           ├── application/                  # Commands (Write), Queries (Read), Ports (SPI), DTOs
│           └── infrastructure/               # PostgreSQL Repositories, Memory Cache, Bcrypt, JWT
├── interfaces/                               # Driver Adapters
│   ├── http/                                 # Express HTTP API & Middlewares (Auth, TenantContext)
│   └── web/client/contexts/identity/         # React SPA Feature Module (Context, Hooks, Components)
└── tests/                                    # Testing Pyramid
    ├── unit/                                 # In-memory Unit Tests (Domain & Handlers)
    ├── integration/                          # Integration Tests (Postgres & Express API)
    ├── acceptance/                           # Living Documentation (Cucumber / Gherkin BDD)
    └── e2e/                                  # End-to-End UI Tests (Playwright / React)
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites

* **Node.js:** `>= 18.x`
* **npm** or **pnpm**
* **PostgreSQL:** `>= 14.x` (or Docker container)

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/angelpixel-core/identity-service.git
cd identity-service

# Install dependencies
npm install
```

### 2. Environment Configuration

Copy `.env.example` and configure your database connection and JWT secret:

```bash
cp .env.example .env
```

```env
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/identity_db
JWT_SECRET=super-secret-tenant-key-32-chars
CACHE_TTL_SECONDS=300
```

### 3. Running the Application

```bash
# Start backend API server
npm run dev:api

# Start web client application
npm run dev:web
```

---

## 🧪 Running Tests

The project enforces test suites across all 4 layers of the testing pyramid:

```bash
# Run Unit Tests (Domain & Handlers)
npm run test:unit

# Run Integration Tests (Express Endpoints & DB)
npm run test:integration

# Run BDD Acceptance Tests (Cucumber / Gherkin)
npm run test:acceptance

# Run E2E Tests (Web UI)
npm run test:e2e

# Run Full Test Suite
npm test
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
