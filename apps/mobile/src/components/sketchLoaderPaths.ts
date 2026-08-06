/**
 * Hand-drawn gym sketches for SketchLoader — ported verbatim from the
 * Notch Design System (components/loading/sketches.js). Each object is an
 * ordered list of path `d` strings — order IS the drawing order, so the
 * mark builds the way a hand would build it (body, then handle, then
 * detail). Curves are deliberately imperfect: no path here is a true
 * circle or rectangle, because a perfect one reads as clip-art the moment
 * it stops moving. All paths live in a 0 0 100 100 viewBox.
 */

export type SketchKey = 'dumbbell' | 'kettlebell' | 'plate' | 'bottle' | 'stopwatch' | 'rope';

export const SKETCHES: Record<SketchKey, { name: string; paths: string[] }> = {
  dumbbell: {
    name: 'Dumbbell',
    paths: [
      'M22,31 C17.5,31.5 15.5,35.5 15.5,50 C15.5,64.5 17.5,68.5 22,69 C26.5,68.5 28.5,64.5 28.5,50 C28.5,35.5 26.5,31.5 22,31 Z',
      'M78,31 C82.5,31.5 84.5,35.5 84.5,50 C84.5,64.5 82.5,68.5 78,69 C73.5,68.5 71.5,64.5 71.5,50 C71.5,35.5 73.5,31.5 78,31 Z',
      'M28.5,45.5 C41,43.8 59.5,44.2 71.5,45.6',
      'M28.5,54.5 C41,56.4 59.5,55.8 71.5,54.4',
    ],
  },
  kettlebell: {
    name: 'Kettlebell',
    paths: [
      'M50,43.5 C34,44 25.5,56.5 27.5,68.5 C29.5,80.5 39.5,86.5 50,86.5 C60.5,86.5 70.5,80.5 72.5,68.5 C74.5,56.5 66,44 50,43.5 Z',
      'M35.5,48 C33.5,27.5 42,19.5 50,19.5 C58,19.5 66.5,27.5 64.5,48',
      'M42,46.5 C41,32.5 45,27 50,27 C55,27 59,32.5 58,46.5',
    ],
  },
  plate: {
    name: 'Weight plate',
    paths: [
      'M50,15.5 C69.5,16 84.5,31 84.5,50 C84.5,69 69.5,84 50,84.5 C30.5,84 15.5,69 15.5,50 C15.5,31 30.5,16 50,15.5 Z',
      'M50,37.5 C57.5,38 62.5,43 62.5,50 C62.5,57 57.5,62 50,62.5 C42.5,62 37.5,57 37.5,50 C37.5,43 42.5,38 50,37.5 Z',
      'M50,15.5 C50,15.5 49,22 50,26.5',
      'M50,84.5 C50,84.5 51,78 50,73.5',
    ],
  },
  stopwatch: {
    name: 'Stopwatch',
    paths: [
      'M50,26.5 C68,27 82,40.5 82,56 C82,71.5 68,85 50,85.5 C32,85 18,71.5 18,56 C18,40.5 32,27 50,26.5 Z',
      'M43,17.5 C46.5,16.5 53.5,16.5 57,17.5',
      'M50,17.5 C50,17.5 49.5,22 50,27',
      'M50,56 C50,56 49.5,45 50,38.5',
      'M50,56 C50,56 57,60.5 62,63.5',
    ],
  },
  bottle: {
    name: 'Water bottle',
    paths: [
      'M37.5,36 C37.5,33.5 39.5,31.5 44,31.5 L56,31.5 C60.5,31.5 62.5,33.5 62.5,36 L62.5,79.5 C62.5,84 59,86.5 50,86.5 C41,86.5 37.5,84 37.5,79.5 Z',
      'M44,31.5 L44,22 C44,19.5 46.5,18.5 50,18.5 C53.5,18.5 56,19.5 56,22 L56,31.5',
      'M37.5,60.5 C44.5,58.5 55.5,62.5 62.5,60.5',
      'M45,68 C45,68 45.5,74 45,78',
    ],
  },
  rope: {
    name: 'Skipping rope',
    paths: [
      'M28,32 C10,52 14,80 32,84 C52,88 70,72 74,52 C77,36 68,26 58,28',
      'M28,32 C25,27.5 22.5,23 24,20',
      'M58,28 C60.5,23.5 63,19.5 61.5,16.5',
      'M24,20 C22,17.5 20,15.5 21.5,13',
    ],
  },
};

export const SKETCH_ORDER: SketchKey[] = ['dumbbell', 'kettlebell', 'plate', 'bottle', 'stopwatch', 'rope'];
