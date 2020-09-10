const { StatusCodes } = require("http-status-codes");
const { sum, sumBy } = require("lodash");
const db = require("../db");

/**
 * Get status code that should be returned in the API response.
 * - OK (200) in case everything is healthy
 * - SERVICE_UNAVAILABLE (503) in case of any failures or if disabled
 */
function getStatusCode() {
  // check whether the portal has been manually disabled
  const disabled = getDisabled();

  if (disabled) {
    return StatusCodes.SERVICE_UNAVAILABLE;
  }

  // grab one most recent critical entry element from DB
  const entry = getCurrentCriticalEntry();

  // find out whether every check in the entry is up
  if (entry && entry.checks.every(({ up }) => up)) {
    return StatusCodes.OK;
  }

  // in case at least one check failed
  return StatusCodes.SERVICE_UNAVAILABLE;
}

/**
 * Get the sample of most recent critical entries and
 * calculate the avarage response time of all of them
 */
function getAvarageResponseTime() {
  // get most recent 10 successfull checks for the calculation
  const sample = db
    .get("critical")
    .orderBy("date", "desc")
    .filter(({ checks }) => checks.every(({ up }) => up))
    .take(10)
    .value();

  // calculate avarage time of response
  return Math.round(sum(sample.map(({ checks }) => sumBy(checks, "time"))) / sample.size);
}

/**
 * Get one, most current critical entry
 */
function getCurrentCriticalEntry() {
  return db.get("critical").orderBy("date", "desc").head().value();
}

/**
 * Get the disabled flag state (manual portal disable)
 */
function getDisabled() {
  return db.get("disabled").value();
}

module.exports = (req, res) => {
  const statusCode = getStatusCode();
  const timeout = statusCode === StatusCodes.OK ? getAvarageResponseTime() : 0;

  // We want to delay the response for the load balancer to be able to prioritize
  // servers based on the successful response time of thid endpoint. Load balancer
  // will pull the server if the response is an error so there is no point in delaying
  // failures, hence 0 timeout on those.
  setTimeout(() => {
    // include some health information in the response body
    const entry = getCurrentCriticalEntry();
    const disabled = getDisabled();

    res.status(statusCode).send({ disabled, entry });
  }, timeout);
};
