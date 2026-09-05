# Tree rendering architecture

```mermaid
flowchart TD
  store[Family store] --> graph[Shared relationship graph]
  graph --> perspective[Per-user perimeter and perspective index]
  perspective --> organic[Organic tree<br/>PixiJS + d3-force]
  perspective --> chart[Chart view<br/>deterministic generations]
  perspective --> list[List and search]
  perspective --> lineage[Lineage paths]
  perspective --> canopy[Canopy lab<br/>isolated deterministic planner]
  perspective --> atlas[Atlas lab<br/>isolated whole-family map]
```

## Isolation contract

- Relationship truth belongs in the shared graph layer.
- Each visualization owns its own layout, rendering, camera, and motion.
- Experimental Canopy and Atlas work must remain opt-in and must not change
  Organic, Chart, List, or Lineage behavior implicitly.
- Performance work is verified with small, blended-family, 1,200-person, and
  5,000-person fixtures; relationship correctness is tested separately from
  visual composition.

