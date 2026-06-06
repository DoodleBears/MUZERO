# PRD: [Feature/Project Name]

**Status:** [Draft/Review/Final]
**Created:** [YYYY-MM-DD]
**Author:** [Name/Team]
**Module:** [Module Name - Brief Description]

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | [Phase 1 Name] | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | [Phase 2 Name] | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| ... | ... | ... | ... |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Briefly describe why this feature/project is needed, the current problems, opportunities, or business goals.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **[Role 1]** | Description | Key permissions |
| **[Role 2]** | Description | Key permissions |

### 1.3 Core Value

1. **[Value 1]**: Description
2. **[Value 2]**: Description
3. **[Value 3]**: Description

---

## 2. System Architecture

### 2.1 Architecture Overview

```
[ASCII diagram of system architecture]
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Frontend** | [Tech] | [Reason] |
| **Backend** | [Tech] | [Reason] |
| **Database** | [Tech] | [Reason] |

### 2.3 Project Structure

```
project/
├── [folder]/
│   ├── [file]
│   └── ...
└── ...
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
[ASCII diagram of data relationships]
```

### 3.2 Database Schema

⚠️ **Important:** Prefer modifying existing database structures; avoid large-scale restructuring.
Reference existing data models using relative paths.

- **Current Schema:** Reference existing database files (e.g., `server/src/db/schema/`)
- **Required Changes:** Describe schema modifications needed
- **Data Migration:** Reference existing migration patterns
- **Integration Points:** How changes integrate with existing data layer
- **Constraints & Indexing:** PK/FK/UNIQUE/CHECK, new/updated indexes (with rationale)
- **Performance Impact:** Query plans, cardinality estimates, example queries
- **Zero-Downtime Strategy:** Online migrations, backfills, dual-write/read switch
- **Rollback Plan:** Down migrations, backups/snapshots, verification steps
- **Data Quality & Validation:** Seeds/backfills, reconciliation, invariants
- **Privacy & Retention:** PII classification, retention/TTL, encryption at rest/in transit

### 3.3 Data Relationship Diagram

```
[ERD or relationship diagram]
```

---

## 4. API Design

### 4.1 API Endpoints

⚠️ **Important:** Prefer modifying existing code; avoid large greenfield structures that disrupt current architecture.
Use relative paths, stable symbol names, and repository permalinks. Line ranges are optional and may drift.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/...` | GET | Description |
| `/api/...` | POST | Description |

### 4.2 Request/Response Examples

```typescript
// Example request/response
```

### 4.3 Error Handling

- **Error States & Edge Cases:** Timeouts, retries, empty states, permission failures
- **Telemetry & Logging:** Events/metrics to emit, log levels, redaction

---

## 5. Frontend Design

### 5.1 Page Structure

```
pages/
├── [page]/
│   ├── page.tsx
│   └── components/
└── ...
```

### 5.2 UI Components

- **Current Implementation:** Reference existing code (e.g., `web/src/components/`)
- **Required Changes:** Describe what needs to be modified, not how to implement
- **UI/Interaction:** Specify UI layout, interaction methods, animations, etc.

### 5.3 State Management

- **Data/State Management:** Main data structures and state transitions involved

---

## 6. Implementation Plan

### Phase 1: [Phase Name]

**Goal:** [Brief description]

**Tasks:**
- [ ] Task 1
- [ ] Task 2

### Phase 1 Checklist

- [ ] Checklist item 1
- [ ] Checklist item 2

### Phase 2: [Phase Name]

**Goal:** [Brief description]

**Tasks:**
- [ ] Task 1
- [ ] Task 2

### Phase 2 Checklist

- [ ] Checklist item 1
- [ ] Checklist item 2

---

## 7. Out of Scope

Clearly define what is NOT included in this PRD:

- Not included item 1
- Not included item 2

---

## 8. Security Considerations

- **Authentication:** How users are authenticated
- **Authorization:** Permission model and access control
- **Data Protection:** Encryption, PII handling
- **Audit Logging:** What actions are logged

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Document Name](link) | Brief description |

---

## 10. Open Questions

Unresolved or to-be-discussed issues:

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | [Question] | Open/Resolved | [Decision if resolved] |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| YYYY-MM-DD | [Name] | Initial draft |

---

> **Note:** This template emphasizes modification of existing code rather than creation of new structures. Always reference existing files, functions, and code locations to maintain accuracy as code evolves.
>
> **Exception Policy:** If net-new components are required, document the rationale, alternatives considered, and obtain tech lead approval.
