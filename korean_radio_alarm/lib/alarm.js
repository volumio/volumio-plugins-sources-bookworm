'use strict';

var SOURCE_URI = 'korean_radio_alarm://';
var STATION_URI_PREFIX = SOURCE_URI + 'station/';

function toInt(value) {
  if (value === null || value === undefined) {
    return NaN;
  }

  if (typeof value === 'object' && value !== null && value.value !== undefined) {
    return toInt(value.value);
  }

  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }

  if (typeof value === 'boolean') {
    return NaN;
  }

  var parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return NaN;
  }

  return parsed;
}

function normalizeSelectValue(value, min, max, step, fallback) {
  var normalized = toInt(value);

  if (!isFinite(normalized)) {
    return fallback;
  }

  if (normalized < min || normalized > max) {
    return fallback;
  }

  if (step > 0 && normalized % step !== 0) {
    return fallback;
  }

  return normalized;
}

function isValidTime(hour, minute) {
  return normalizeSelectValue(hour, 0, 23, 1, null) !== null &&
    normalizeSelectValue(minute, 0, 59, 1, null) !== null;
}

function buildCronExpressions(hour, minute, weekdays) {
  if (!isValidTime(hour, minute) || !weekdays) {
    return [];
  }

  var minuteValue = normalizeSelectValue(minute, 0, 59, 1, null);
  var hourValue = normalizeSelectValue(hour, 0, 23, 1, null);
  var weekdayOrder = [
    { key: 'monday', value: 1 },
    { key: 'tuesday', value: 2 },
    { key: 'wednesday', value: 3 },
    { key: 'thursday', value: 4 },
    { key: 'friday', value: 5 },
    { key: 'saturday', value: 6 },
    { key: 'sunday', value: 0 }
  ];

  var expressions = [];

  for (var i = 0; i < weekdayOrder.length; i++) {
    var entry = weekdayOrder[i];
    if (weekdays[entry.key] === true) {
      expressions.push('0 ' + minuteValue + ' ' + hourValue + ' * * ' + entry.value);
    }
  }

  return expressions;
}

function stationOptionsFromCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.groups)) {
    return [];
  }

  var options = [];

  catalog.groups.forEach(function (group) {
    if (!group || !Array.isArray(group.stations)) {
      return;
    }

    var groupName = group.name || group.id || '';

    group.stations.forEach(function (station) {
      if (!station || !station.id || (!station.streamUrl && !station.streamResolver)) {
        return;
      }

      options.push({
        value: STATION_URI_PREFIX + station.id,
        label: groupName ? groupName + ' - ' + station.name : station.name
      });
    });
  });

  return options;
}

function findStationByUri(catalog, stationUri) {
  if (!catalog || !Array.isArray(catalog.groups) || !stationUri) {
    return null;
  }

  var target = stationUri;

  if (typeof stationUri === 'object' && stationUri !== null) {
    if (stationUri.uri) {
      target = stationUri.uri;
    } else if (stationUri.value) {
      target = stationUri.value;
    }
  }

  if (target.indexOf(STATION_URI_PREFIX) === 0) {
    target = target.replace(STATION_URI_PREFIX, '');
  }

  for (var i = 0; i < catalog.groups.length; i++) {
    var group = catalog.groups[i];
    if (!group || !Array.isArray(group.stations)) {
      continue;
    }

    for (var j = 0; j < group.stations.length; j++) {
      var station = group.stations[j];
      if (!station) {
        continue;
      }

      if (station.id === target || station.uri === target || station.uri === stationUri) {
        return station;
      }

      if (station.uri === STATION_URI_PREFIX + target || station.id === target) {
        return station;
      }
    }
  }

  return null;
}

function firstStationUriFromCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.groups)) {
    return null;
  }

  for (var i = 0; i < catalog.groups.length; i++) {
    var group = catalog.groups[i];
    if (!group || !Array.isArray(group.stations) || group.stations.length === 0) {
      continue;
    }

    return STATION_URI_PREFIX + group.stations[0].id;
  }

  return null;
}

module.exports = {
  SOURCE_URI: SOURCE_URI,
  STATION_URI_PREFIX: STATION_URI_PREFIX,
  normalizeSelectValue: normalizeSelectValue,
  isValidTime: isValidTime,
  buildCronExpressions: buildCronExpressions,
  stationOptionsFromCatalog: stationOptionsFromCatalog,
  findStationByUri: findStationByUri,
  firstStationUriFromCatalog: firstStationUriFromCatalog
};
