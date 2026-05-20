let prismaUnavailableReason = null;

function setPrismaUnavailableReason(reason) {
  prismaUnavailableReason = reason || null;
}

function getPrismaUnavailableReason() {
  return prismaUnavailableReason;
}

function isPrismaReady() {
  return !prismaUnavailableReason;
}

module.exports = {
  setPrismaUnavailableReason,
  getPrismaUnavailableReason,
  isPrismaReady,
};
