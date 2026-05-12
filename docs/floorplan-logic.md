# Floor Plan Logic

This document describes how each floor is generated and how the unit selection/upgrade logic works.

## Layout Inputs (Per Floor)

The base layout parameters live in [src/App.jsx](src/App.jsx#L8-L36). These values define the number of columns/rows, the cell sizes, and spacing between levels. The per-level hallway sizes and labels are also defined here.

- Level positioning and vertical spacing: [src/App.jsx](src/App.jsx#L38-L49)
- Hallway geometry for each level: [src/App.jsx](src/App.jsx#L51-L90)

## Unit Generation (Per Floor)

Each floor is generated independently inside `defaultUnits()` and stored as `levels: [{ level, units: [...] }]`.

- Unit generation per floor (2 rows x 6 columns, each cell expands to 2x2 sub-units): [src/App.jsx](src/App.jsx#L92-L148)
- Demo ownership seeds per floor: [src/App.jsx](src/App.jsx#L137-L147)

## State Normalization

When loading from storage, legacy flat `units` arrays are converted into per-level arrays.

- State normalization and migration: [src/App.jsx](src/App.jsx#L151-L161)

## Rendering Data Flow (Single SVG)

`FloorPlan` receives `levels` and flattens them into `flatUnits` so the SVG rendering and selection logic remains shared across floors.

- Flattening per-level units: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L15-L16)
- Grouping units by cell (4 sub-units per cell): [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L23-L31)

## Ownership and Upgrade Logic

Upgrades require full ownership of a 4-unit cell. Eligible targets are either:
- Horizontal pairs in empty cells on the same level.
- Vertical pairs in the matching cell above/below.

- Ownership checks: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L33-L43)
- Target selection rules: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L45-L116)

## SVG Layout and Floor Separation

The SVG view box is computed from all unit extents, then hallways and level bands are drawn before units.

- View box sizing: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L137-L147)
- Hallway/service zones: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L164-L184)
- Level bands and labels: [src/components/FloorPlan.jsx](src/components/FloorPlan.jsx#L186-L230)
