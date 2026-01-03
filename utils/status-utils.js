const {
  MACHINE_STATUS,
  MACHINE_STATUS_LABELS,
  JOB_STATUS,
  JOB_STATUS_LABELS
} = require('utils/status-codes');

function mapMachineStatusIntToLabel(statusInt) {
  if (statusInt === MACHINE_STATUS.PRINTING_RECOVERY) return 'PRINTING';
  if (MACHINE_STATUS_LABELS[statusInt]) return MACHINE_STATUS_LABELS[statusInt];
  return null;
}

function mapJobStatusIntToLabel(statusInt) {
  if ([18, 19, 21].includes(statusInt)) return 'LOADING';
  if (statusInt === JOB_STATUS.PRINTING_RECOVERY) return 'PRINTING';
  if (JOB_STATUS_LABELS[statusInt]) return JOB_STATUS_LABELS[statusInt];
  return null;
}

function mapStatusIntToLabel(statusInt) {
  if ([18, 19, 21].includes(statusInt)) return 'LOADING';
  if (statusInt === MACHINE_STATUS.PRINTING_RECOVERY) return 'PRINTING';
  if (MACHINE_STATUS_LABELS[statusInt]) return MACHINE_STATUS_LABELS[statusInt];
  return null;
}

function parseStatusPayload(data) {
  const statusBlock = data?.Status || {};
  let currentStatus = statusBlock.CurrentStatus;
  if (typeof currentStatus === 'number') currentStatus = [currentStatus];
  let machineStatusCode = Array.isArray(currentStatus) && currentStatus.length ? currentStatus[0] : null;
  let machineState = mapMachineStatusIntToLabel(machineStatusCode) || 'UNKNOWN';

  const jobStatusCode = statusBlock.PrintInfo?.Status ?? null;
  let jobState = mapJobStatusIntToLabel(jobStatusCode) || 'UNKNOWN';
  
  // For consolidated status: use machine state, but handle PRINTING_RECOVERY special case
  let consolidatedStatus = machineState;
  if (jobStatusCode === JOB_STATUS.PRINTING_RECOVERY) {
    consolidatedStatus = 'PRINTING';
  }

  return { 
    status: {
      consolidated: consolidatedStatus,
      machine: {
        state: machineState,
        code: machineStatusCode
      },
      job: {
        state: jobState,
        code: jobStatusCode
      }
    },
    // Backward compatibility
    status_code: machineStatusCode
  };
}

module.exports = {
  mapStatusIntToLabel,
  mapMachineStatusIntToLabel,
  mapJobStatusIntToLabel,
  parseStatusPayload
};
