/*
 * 03 / 3D Spatial Studio on the overview: the room planner's four
 * capabilities as an editorial specification grid, each paired with the
 * studio photograph of a part it plans (the exports pillar shows a drawing
 * instead). Pure data with no planner import, so the overview bundle stays
 * free of the studio engines. Every figure is the engines' own figure:
 * tests/spatial-studio-editorial.spec.js reads each one back against
 * room-3d.js, room-walkthrough.js, illuminance-field.js, electrical.js,
 * drivers.js, room-physics.js, blueprint-sheet.js and dxf-export.js.
 */

function pillar({ specs, photo = null, ...rest }) {
  return Object.freeze({
    ...rest,
    photo: photo ? Object.freeze(photo) : null,
    specs: Object.freeze(specs.map(([label, value]) => Object.freeze({ label, value }))),
  });
}

export const STUDIO_PILLARS = Object.freeze([
  pillar({
    id: 'envelope',
    index: '01',
    title: 'Four-Wall Envelope',
    summary: 'Dimensioned room geometry to the centimetre (W x L x H) with full 360-degree orbit and plan views.',
    photo: { product: 'linear-pendant-150', finish: 'walnut', alt: 'Linear Suspension Pendant 150 in walnut, hung in the corner of a daylight room' },
    specs: [
      ['Width', '240 to 900 cm'],
      ['Length', '200 to 900 cm'],
      ['Height', '220 to 420 cm'],
      ['Orbit', '360 deg yaw / 5 to 85 deg pitch'],
    ],
  }),
  pillar({
    id: 'eye-level',
    index: '02',
    title: '165 cm Eye-Level Walkthrough',
    summary: 'First-person walkthrough at human eye height with live wall illuminance readings.',
    photo: { product: 'wall-sconce-80', finish: 'walnut', alt: 'Vertical Architectural Sconce 80 in walnut at eye height on a plaster wall' },
    specs: [
      ['Eye height', '165 cm'],
      ['Lens', '78 deg / 50 to 92 deg'],
      ['Pace', '145 cm/s walk / 215 cm/s run'],
      ['Wall lux', '24 x 16 point grid'],
    ],
  }),
  pillar({
    id: 'bus',
    index: '03',
    title: '24V SELV Bus & Acoustic RT60',
    summary: 'Automatic 24V DC driver load balancing, daisy-chain validation and Sabine RT60 acoustics.',
    photo: { product: 'power-hub-dali', finish: 'obsidian', alt: 'Recessed 24V DALI-2 Bus Hub in obsidian, the feed of the bus, on a plaster wall' },
    specs: [
      ['Bus', '24V DC SELV / 150 W per run'],
      ['Drivers', '60 W and 150 W'],
      ['Voltage drop', '3% limit, hop by hop'],
      ['Acoustics', 'RT60 / 125 Hz to 4 kHz / STI'],
    ],
  }),
  pillar({
    id: 'exports',
    index: '04',
    title: 'Architectural CAD Exports',
    summary: 'Direct 1:20 dimensioned SVG elevations, AutoCAD DXF, Wavefront OBJ and an exact bill of materials.',
    specs: [
      ['Elevation', '1:20 SVG / ISO A3'],
      ['CAD', 'AutoCAD R12 DXF'],
      ['Model', 'Wavefront OBJ'],
      ['Schedule', 'Bill of materials'],
    ],
  }),
]);

export const STUDIO_PILLAR_IDS = Object.freeze(STUDIO_PILLARS.map((entry) => entry.id));
