// Central enums/constants for printer status codes
// Machine-level status
const MACHINE_STATUS = {
  IDLE: 0,
  PRINTING: 1,
  FILE_TRANSFERRING: 2,
  LEVELING: 5,
  STOPPING: 7,
  STOPPED: 8,
  HOMING: 9,
  RECOVERY: 12,
    PRINTING_RECOVERY: 13,
  // Add other codes as needed
};

const MACHINE_STATUS_LABELS = {
  0: 'IDLE',
  1: 'PRINTING',
  2: 'FILE_TRANSFERRING',
  5: 'LEVELING',
  7: 'STOPPING',
  8: 'STOPPED',
  9: 'HOMING',
  12: 'RECOVERY',
  13: 'PRINTING',
};

// Print-job sub-status
const JOB_STATUS = {
  IDLE: 0,
  HOMING: 1,
  DROPPING: 2,
  PRINTING: 3,
  LIFTING: 4,
  PAUSING: 5,
  PAUSED: 6,
  STOPPING: 7,
  STOPPED: 8,
  COMPLETE: 9,
  FILE_CHECKING: 10,
  RECOVERY: 12,
  PRINTING_RECOVERY: 13,
  LOADING: 15,
  PREHEATING: 16,
  LEVELING: 20,
  // Add other codes as needed
};

const JOB_STATUS_LABELS = {
  0: 'IDLE',
  1: 'HOMING',
  2: 'DROPPING',
  3: 'PRINTING',
  4: 'LIFTING',
  5: 'PAUSING',
  6: 'PAUSED',
  7: 'STOPPING',
  8: 'STOPPED',
  9: 'COMPLETE',
  10: 'FILE_CHECKING',
  12: 'RECOVERY',
  13: 'PRINTING_RECOVERY',
  15: 'LOADING',
  16: 'PREHEATING',
  20: 'LEVELING',
};

module.exports = {
  MACHINE_STATUS,
  MACHINE_STATUS_LABELS,
  JOB_STATUS,
  JOB_STATUS_LABELS,
};
