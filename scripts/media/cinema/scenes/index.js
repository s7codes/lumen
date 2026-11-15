import { CAD_FILMS } from './cad-acts.js';
import column from './icon-column.js';
import monolith from './icon-monolith.js';
import suspension from './icon-suspension.js';

/** Every film the stage can shoot, by id. */
export const SCENES = Object.freeze({
  'icon-monolith': monolith,
  'icon-suspension': suspension,
  'icon-column': column,
  ...CAD_FILMS,
});
