---
name: TriByte sub-topic order sync
description: Rules for retaining TriByte’s nested sub-topic sequence without overwriting intentional LMS ordering.
---

# TriByte sub-topic order sync

Newly discovered TriByte sub-topics must receive their zero-based position from their parent topic’s authenticated Sub-topics page.

**Why:** A prior resource scan assigned every discovered sub-topic order zero. The resulting records and parent links were correct, but session lists no longer matched TriByte’s sequence.

**How to apply:** When correcting older imports, change order only when every expected sibling has the legacy all-zero value. Preserve any non-default sequence because it may be an administrator’s intentional LMS reorder.