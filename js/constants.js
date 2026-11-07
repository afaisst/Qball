// Qball — physical constants and default parameters.
// All units are SI: meters, seconds, kilograms, radians.
// Coordinate system: origin at table center, +x toward the foot rail (right),
// +y toward the top long rail, +z up out of the cloth.
window.QB = window.QB || {};

// Table size (playing surface, cushion nose to cushion nose). The player can choose; the choice is stored and the
// page reloads, so everything (rails, pockets, markings, drills, the 3D room) is built for that size.
QB.TABLE_SIZES = {
  9: { L: 2.540, W: 1.270, label: '9 ft', note: 'tournament, 100" × 50"' },
  8: { L: 2.235, W: 1.118, label: '8 ft', note: 'home table, 88" × 44"' },
  7: { L: 1.981, W: 0.991, label: '7 ft', note: 'bar box, 78" × 39"' },
};
QB.tableFt = 9;
try { const f = +localStorage.getItem('qball.tableFt'); if (QB.TABLE_SIZES[f]) QB.tableFt = f; } catch (e) { /* no storage (e.g. Node tests) */ }

QB.C = {
  // --- Table (default 9 ft, WPA spec playing surface 100" x 50"; see QB.TABLE_SIZES) ---
  TABLE_L: QB.TABLE_SIZES[QB.tableFt].L,   // playing length (cushion nose to cushion nose)
  TABLE_W: QB.TABLE_SIZES[QB.tableFt].W,   // playing width
  CUSHION_W: 0.05,        // visual/physical depth of cushion rubber behind the nose line
  RAIL_W: 0.11,           // wooden rail width (visual only)

  // Pockets (WPA: corner mouth 4.5"-4.625", side mouth 5"-5.125")
  CORNER_MOUTH: 0.1143,   // 4.5"
  SIDE_MOUTH: 0.1270,     // 5.0"
  CORNER_JAW_ANGLE: 142,  // deg, angle between cushion nose and pocket facing
  SIDE_JAW_ANGLE: 104,    // deg
  CORNER_HOLE_R: 0.058,   // radius of the drop hole (ball falls when its center is inside)
  CORNER_HOLE_OFFSET: 0.075, // hole center distance behind mouth line, along pocket axis
  SIDE_HOLE_R: 0.060,
  SIDE_HOLE_OFFSET: 0.068,

  CUSHION_H_FRAC: 0.635,  // cushion nose height as fraction of ball diameter (WPA 62.5-64.5%)

  // --- Balls ---
  BALL_R: 0.028575,       // 2.25" diameter
  BALL_M: 0.17,           // kg (6 oz)
  BALL_E_MOD: 5.0e9,      // Pa, Young's modulus of phenolic resin (ball-ball contact ~0.25 ms; used for groups of touching balls)
  BALL_NU: 0.35,          // Poisson's ratio
  G: 9.81,

  // --- Simulation ---
  DT: 0.0002,             // physics substep (s) -> 5 kHz
  MAX_SIM_TIME: 30,       // safety cap for one shot (s)
  V_EPS: 1e-4,            // m/s: below this a ball is considered stopped
  U_EPS: 1e-5,            // m/s: contact-point slip below this = rolling

  // --- Cue / shot ---
  MAX_PULL: 0.30,         // m of cue pull-back for full power
  MAX_CUE_SPEED: 6.0,     // m/s cue (stick) speed at full power; center hit -> ~8 m/s ball speed
  CUE_MASS: 0.54,         // kg (19 oz)
  TIP_E: 0.80,            // cue tip-ball collision efficiency (restitution)
  TIP_MAX: 0.95,          // largest selectable tip offset (units of R); miscue limit follows from tipFriction
  TIP_MU_KINETIC: 0.20,   // tip friction once it slides off the ball (miscue)
  MISCUE_TRANSFER: 0.5,   // fraction of the impulse delivered in a miscue (empirical)
  MAX_ELEV: 80,           // deg, max cue elevation
  CUE_LEN: 1.47,          // 58" cue (visual)
};

// The cues in the player's rack. Each cue sets the cue-related physics parameters (mass, tip efficiency, tip
// friction, shaft end mass) and how fast it can be swung; `look` = its segments from the tip (d0, d1 in m, colour).
//  - Playing cue: 19 oz, layered leather tip (soft, grips the chalk well: spin up to ~0.55R).
//  - Break cue: 20 oz, hard phenolic tip and ferrule. The hard tip loses less energy (efficiency 0.90 vs 0.80) and
//    the cue is swung all-out (up to 9 m/s instead of 6): the cue ball leaves at up to ~13 m/s (~30 mph), a strong
//    pro break. The phenolic tip holds chalk less well (miscue sooner) and the stiff shaft squirts more.
//  - Jump cue: short (102 cm) and light (8 oz), hard phenolic tip. Raised to ~50°, the first contact stops it, so it
//    doesn't hit the ball a second time as the slate throws the ball up: the ball jumps. (A full cue that steep pins
//    the ball to the cloth.)
QB.CUES = {
  play: { id: 'play', name: 'Playing cue', note: '19 oz · leather tip', len: 1.47, cueMass: 0.54, tipE: 0.80, tipFriction: 0.66, cueEndMass: 0.003, maxSpeed: 6.0,
    look: [[0, 0.006, '#3b6fd8'], [0.006, 0.03, '#f2efe6'], [0.03, 0.80, '#e3c48f'], [0.80, 1.02, '#2a1408'], [1.02, 1.30, '#1a1a1a'], [1.30, 1.47, '#2a1408']] },
  break: { id: 'break', name: 'Break cue', note: '20 oz · phenolic tip', len: 1.47, cueMass: 0.567, tipE: 0.90, tipFriction: 0.55, cueEndMass: 0.008, maxSpeed: 9.0,
    look: [[0, 0.006, '#cfc6ad'], [0.006, 0.045, '#f6f3ea'], [0.045, 0.80, '#e8cc95'], [0.80, 0.99, '#111111'], [0.99, 1.02, '#c21d1d'], [1.02, 1.30, '#7a1212'], [1.30, 1.47, '#111111']] },
  jump: { id: 'jump', name: 'Jump cue', note: '8 oz · short · phenolic', len: 1.02, cueMass: 0.23, tipE: 0.90, tipFriction: 0.55, cueEndMass: 0.003, maxSpeed: 7.0,
    look: [[0, 0.006, '#cfc6ad'], [0.006, 0.04, '#f6f3ea'], [0.04, 0.62, '#e8cc95'], [0.62, 0.66, '#d9a400'], [0.66, 0.86, '#1b3f8f'], [0.86, 1.02, '#111111']] },
};
QB.CUE_PARAMS = ['cueMass', 'tipE', 'tipFriction', 'cueEndMass'];

// Tunable physics parameters (exposed in the test panel).
QB.defaultParams = function () {
  return {
    muSlide: 0.11,   // ball-cloth sliding friction coefficient (typ. 0.15-0.25)
    muRoll: 0.0155,  // rolling resistance coefficient (literature 0.005-0.015; tuned by feel)
    spinDecel: 20.0, // rad/s^2, decay of vertical-axis (side) spin
    cueMass: 0.54,   // kg, cue mass (the selected cue sets this)
    tipE: 0.80,      // cue tip–ball collision efficiency (restitution); hard phenolic break tips ~0.9
    cueEndMass: 0.003, // kg, effective end mass of the shaft -> squirt (0 = no squirt; low-deflection ~0.005)
    tipFriction: 0.66, // chalked tip-ball friction; miscue when tan(offset angle) > this -> limit = mu/sqrt(1+mu^2) = 0.55R
    ballFriction: 1.0, // scale on measured ball-ball friction (0.01-0.11 vs slip speed) -> throw; 0 = frictionless
    eBall: 0.975,    // ball-ball coefficient of restitution (phenolic: 0.92-0.98)
    eTable: 0.5,     // ball–slate (through the cloth) restitution: how a raised-cue shot or a landing ball bounces
    eCushion: 0.85,  // cushion coefficient of restitution
    muCushion: 0.25, // ball-cushion friction (used by the 'realistic' cushion model)
    cushionModel: 'mathavan', // 'mathavan' (2010, cushion + slate friction) | 'realistic' (Han 2005) | 'simple'
    cushionHeight: 0.635, // cushion nose height / ball diameter (WPA 0.625-0.645); higher = more spin reversal
    eCushionSlope: 0.018,   // e drops by this much per m/s of normal impact speed (harder hits -> deader cushion)
  };
};

// Ball colors by number (standard set).
QB.BALL_COLORS = {
  0: '#f8f6ee',
  1: '#f2c200', 2: '#1f4fbf', 3: '#d42a1e', 4: '#5a2a86', 5: '#f07a12',
  6: '#127a3a', 7: '#7a1f1a', 8: '#151515',
  9: '#f2c200', 10: '#1f4fbf', 11: '#d42a1e', 12: '#5a2a86', 13: '#f07a12',
  14: '#127a3a', 15: '#7a1f1a',
};
