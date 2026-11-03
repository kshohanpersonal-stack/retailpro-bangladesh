# ADR-003 — Inventory Costing Method
**Status:** Accepted (2026-11-03)
**Decision:** Moving Weighted Average Cost per product (and per batch for batch-tracked products), integer poisha valuation.
**Rationale:** Robust under partial returns and frequent small purchases; avoids FIFO layer fragmentation for grocery retail; keeps valuation and COGS tied to a single value pool; simple to audit and test.
**Rules:** Incoming stock adds qty×cost to the pool; outgoing consumes roundHalfUp(value×qty_out/qty_before); zero qty forces zero value; sales returns restore at original recorded cost with any delta posted to inventory adjustment; incomplete cost is flagged, never fabricated.
**Consequences:** COGS is not tied to specific purchase layers; acceptable and documented for this market. FIFO remains a possible future mode but is NOT mixed in v1.
