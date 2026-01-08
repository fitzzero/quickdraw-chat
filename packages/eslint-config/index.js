// Main export - re-exports all configs for convenient access
module.exports = {
  configs: {
    base: require("./base"),
    server: require("./server"),
    client: require("./client"),
    shared: require("./shared"),
  },
};
