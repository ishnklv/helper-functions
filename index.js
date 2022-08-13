/** @format */

const crypto = require('crypto');
const url = require('url');
const _ = require('lodash');
const moment = require('moment');
const PhoneNumber = require('awesome-phonenumber');
const {ObjectId} = require('mongodb');
const fetch = require('node-fetch');

const isoToGcal = require('../data/iso-to-gcal.json') || {};

const emailRegex =
  /^[a-z0-9._+-]+@((\d{1,3}\.){3}\d{1,3}|[a-z0-9]{2,}(\.[a-z0-9]{2,})*)$/i;
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.emailRegex = emailRegex;
exports.uuidRegex = uuidRegex;

exports.throttlePromised = function (fn, interval = 100) {
  var i = -1;

  return function (...args) {
    i++;

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        fn(...args)
          .then(resolve)
          .catch(reject);
      }, i * interval);
    });
  };
};

function sanitizeRegex(string) {
  return string.replace(/([+.)(\][])/g, '\\$1');
}

function isObjectId(string) {
  const regex = /^[0-9a-f]{24}$/i;

  return regex.test(string) && ObjectId.isValid(string);
}

exports.sanitizeRegex = sanitizeRegex;

exports.normalizeSearch = function normalizeSearch(
  search = {},
  options = {},
) {
  search = _.clone(search);

  _.keys(search).forEach((field) => {
    if (field.indexOf('|') > -1) {
      _.compact(field.split('|')).forEach((fieldy) => {
        search[fieldy] = search[field];
      });

      delete search.field;
    }
  });

  _.keys(search).forEach((field) => {
    if (typeof search[field] !== 'string') {
      return;
    }
    if (search[field].indexOf('|') > -1) {
      search[field] = {
        $in: _.compact(
          search[field]
            .split('|')
            .map((string) =>
              isObjectId(string)
                ? ObjectId(string)
                : string,
            ),
        ),
      };
    }
      // if (/^[<>]/.test(search[field])) {
      //     const search[field].match(/^([<>])(.+)$/);

      //     search[field] =
    // }
    else if (search[field].match(/!/)) {
      search[field] = {
        $ne: JSON.parse(search[field].replace('!', '')),
      };
    } else if (search[field].match(/^\d+$/)) {
      search[field] = parseInt(search[field]);
    } else if (search[field].match(/\d+-\d+/)) {
      const s = search[field];
      search[field] = s;
    } else if (
      search[field] === 'true' ||
      search[field] === 'false'
    ) {
      search[field] = search[field] === 'true';
    } else if (isObjectId(search[field])) {
      search[field] = ObjectId(search[field]);
    } else if (!options.noRegex) {
      let searchTerm = sanitizeRegex(search[field]);

      if (options.matchFromStart) {
        searchTerm = '^' + searchTerm;
      }
      search[field] = new RegExp(searchTerm, 'i');
    }
  });

  let $or = [];
  _.keys(search).forEach((field) => {
    if (
      typeof search[field] === 'string' &&
      search[field].match(/\d+-\d+/)
    ) {
      const ranges = search[field]
        .replace(/,$/, '')
        .split(',')
        .map((range) => {
          const match = range.match(/(\d+)-(\d+)/);

          return match ? match.slice(1, 3) : null;
        })
        .filter((range) => range);

      if (ranges.length < 1) {
        return;
      } else if (ranges.length === 1) {
        if ($or.length < 1) {
          return (search[field] = {
            $gte: parseInt(ranges[0][0]),
            $lte: parseInt(ranges[0][1]),
          });
        } else {
          $or = $or.map((query) => ({
            ...query,
            [field]: {
              $gte: parseInt(ranges[0][0]),
              $lte: parseInt(ranges[0][1]),
            },
          }));
        }
      }

      if ($or.length < 1) {
        $or = ranges.map((range) => ({
          ...search,
          [field]: {
            $gte: parseInt(range[0]),
            $lte: parseInt(range[1]),
          },
        }));
      } else {
        $or = ranges.reduce((result, range) => {
          const projection = $or.map((search) => ({
            ...search,
            [field]: {
              $gte: parseInt(range[0]),
              $lte: parseInt(range[1]),
            },
          }));

          return result.concat(projection);
        }, []);
      }
    }
  });

  return $or.length < 1 ? search : {$or};
};

exports.normalizeSort = (sort, schema, locale) => {
  const props = sort.split(',').map((s) => ({
    prop: s.replace(/^-/, ''),
    order: s[0] === '-' ? -1 : 1,
  }));

  const sortObject = {};
  for (let {prop, order} of props) {
    const isLangMap = schema[prop] && schema[prop].langMap;

    if (isLangMap) {
      prop = `${prop}.${locale}`;
    }

    sortObject[prop] = order;
  }
  return sortObject;
};

exports.emptyFields = (data = {}) => {
  return _.keys(data)
    .filter((key) => {
      const field = data[key];
      const type = typeof data[key];
      if (type === 'string') {
        return !field;
      }
      if (type === 'object') {
        return field === null;
      }
    })
    .reduce((acc, key) => ({...acc, [key]: ''}), {});
};

exports.urlize = function urlize(string) {
  const {protocol} = url.parse(string);

  if (protocol) {
    return string;
  } else {
    return `http://${string}`;
  }
};

function getRandomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

exports.generateCode = function generateCode(len) {
  let randomStr = '';

  for (let i = 0; i < len; i++) {
    randomStr += getRandomBetween(1, 9).toString();
  }

  return randomStr;
};

exports.multilangField = (langs) => (schema) => {
  return langs.reduce((commonSchema, lang) => {
    return _.extend(
      {
        [lang]: schema,
      },
      commonSchema,
    );
  }, {});
};

exports.clearPhone = (phone) => {
  return phone.replace(/[^\d+]/gi, '').trim();
};

exports.getRandomBetween = getRandomBetween;

function lpad(str, pad, length) {
  str = String(str);

  while (str.length < length) {
    str = pad + str;
  }
  return str.slice(-length);
}

function minutesToHours(minutes) {
  const sign = minutes > -1 ? '-' : '+';
  const hours = Math.abs(Math.ceil(minutes / 60));
  minutes = minutes % 60;

  return sign + lpad(hours, '0', 2) + lpad(minutes, '0', 2);
}

exports.dateToISO = (date) => {
  const values = {
    YYYY: date.getFullYear(),
    MM: lpad(date.getMonth() + 1, '0', 2),
    DD: lpad(date.getDate(), '0', 2),
    HH: lpad(date.getHours(), '0', 2),
    mm: lpad(date.getMinutes(), '0', 2),
    ss: lpad(date.getSeconds(), '0', 2),
    ms: lpad(date.getMilliseconds(), '0', 3),
    ZZ: minutesToHours(date.getTimezoneOffset()),
  };

  // let format = 'YYYY-MM-DDTHH:mm:ss.msZZ';
  // Object.getOwnPropertyNames(values).forEach((k) => {
  //     format = format.replace(k, values[k]);
  // });

  return (
    `${values['YYYY']}-${values['MM']}-${values['DD']}T` +
    `${values['HH']}:${values['mm']}:${values['ss']}.${values['ms']}${values['ZZ']}`
  );
};

exports.formatFbGender = (gender) => {
  if (/male|female/.test(gender)) {
    return gender;
  }

  return 'other';
};

exports.formatFbBirthday = (birthday) => {
  const monthDayYear = /^\d{2}\/\d{2}\/\d{4}$/;

  if (!monthDayYear.test(birthday)) {
    return null;
  }

  const [month, day, year] = birthday.split('/');

  return _.compact([year, month, day]).join('-');
};

exports.generatePassword = (len) => {
  const bytesLen = Math.ceil((len * 3) / 4);
  return crypto
    .randomBytes(bytesLen)
    .toString('base64')
    .slice(0, len)
    .replace(/\+/g, '0')
    .replace(/\//g, '0');
};

exports.generateCode = function generateCode(len) {
  const nums = _.range(9);

  return _.range(len)
    .map(() => _.sample(nums))
    .join('');
};

exports.isSameArray = (arr1, arr2, fields = []) => {
  return arr1.reduce((result, __, i) => {
    return (
      result &&
      _.isEqual(
        _.pick(arr1[i], fields),
        _.pick(arr2[i], fields),
      )
    );
  }, true);
};

exports.formatAmount = (amount) => {
  return (amount / 100).toFixed(2);
};

exports.fillTemplateString = function (template, ...words) {
  words.forEach((word) => {
    template = template.replace('%s', word);
  });

  return template;
};

exports.textPadding = (text, padding = '*') => {
  const maxLength = Math.max(..._.map(text.split('\n'), 'length'));

  const paddingLine = padding.repeat(maxLength);

  return `${paddingLine}\n\n${text.trim()}\n\n${paddingLine}`;
};

exports.formatCents = (cents) => {
  const dollars = cents / 100;

  return dollars === Math.round(dollars)
    ? dollars.toString()
    : dollars.toFixed(2);
};

exports.flatten = (object) => {
  const result = {};

  const copyToResult = (object, parentKey) => {
    for (const key in object) {
      const childKey = parentKey ? `${parentKey}.${key}` : key;
      if (
        typeof object[key] === 'object' &&
        object[key] instanceof ObjectId
      ) {
        result[childKey] = object[key].toString();
      } else if (typeof object[key] === 'object') {
        copyToResult(object[key], childKey);
      } else {
        result[childKey] = object[key];
      }
    }
  };

  copyToResult(object);

  return result;
};

exports.generateSessionToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

exports.generateOrderNumber = (numbersLen, lettersLen = 3) => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0'.split('');
  const numbers = '123456789'.split('');

  const randomLetters = _.range(lettersLen)
    .map(() => _.sample(letters))
    .join('');
  const randomNumbers = _.range(numbersLen)
    .map(() => _.sample(numbers))
    .join('');

  return randomLetters.concat(randomNumbers);
};

exports.emptyLangMap =
  (langs, placeholder = null) =>
    () => {
      const langMap = {};

      langs.forEach((lang) => {
        langMap[lang] = placeholder;
      });

      return langMap;
    };

const parseTime = (timeString) => {
  const defaultTime = {hours: 0, minutes: 0};
  const regex = /(\d{2}):(\d{2})/;

  const match = timeString.match(regex);

  if (!match) {
    return defaultTime;
  }

  let [, hours, minutes] = match;

  hours = Number(hours);
  minutes = Number(minutes);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return defaultTime;
  }

  return {hours, minutes};
};

exports.parseTime = parseTime;

exports.pairId = (...ids) => {
  return ids.map(String).sort().join('');
};

exports.formatUpdateMark = ({createDate, messageId, chatId}) => {
  const timeStringCap = 13;

  const timeStringArray = String(createDate.valueOf()).split('');

  const zeroes = _.fill(
    Array(timeStringCap - timeStringArray.length),
    0,
  );
  const timeString = zeroes.concat(timeStringArray).join('');

  return `${timeString}|${messageId || chatId}`;
};

exports.geoDistance = (pointX = [0, 0], pointY = [0, 0]) => {
  const [lon1, lat1] = pointX;
  const [lon2, lat2] = pointY;

  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
    Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  return Math.round(d * 100) / 100;
};

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

exports.normalizedTitle = (title) => {
  return title.trim().replace(/\s+/, ' ').toLowerCase();
};

function isValue(v) {
  return v !== undefined && v !== null && v !== '';
}
function allFieldsPresent(object, fields) {
  return fields.reduce(
    ({result, missingFields}, field) => {
      const [root, part] = field.split('.');

      const o =
        part &&
        typeof object[root] === 'object' &&
        !Array.isArray(object[root])
          ? object[root]
          : object;

      if (Array.isArray(o[root])) {
        const r = isValue(o[part || root][0]);
        return {
          result: result && r,
          missingFields: r
            ? missingFields
            : missingFields.concat(field),
        };
      } else {
        const r = isValue(o[part || root]);
        return {
          result: result && r,
          missingFields: r
            ? missingFields
            : missingFields.concat(field),
        };
      }
    },
    {
      result: true,
      missingFields: [],
    },
  );
}
exports.allFieldsPresent = allFieldsPresent;

function arraify(v) {
  return typeof v === 'object' && v instanceof Array ? v : [v];
}
function propAtPath(object, path = []) {
  path = typeof path === 'string' ? path.split('.') : path;
  const [prop, ...restPath] = path;

  if (restPath.length < 1) {
    return object[prop] || object;
  } else if (typeof object[prop] === 'object') {
    if (object[prop] instanceof Array) {
      return object[prop].map((val) =>
        typeof val === 'object'
          ? propAtPath(val, restPath)
          : val,
      );
    } else {
      return propAtPath(object[prop], restPath);
    }
  } else {
    return object[prop];
  }
}
exports.extractKeywords = (object, fields) => {
  return fields
    .map((field) => {
      return arraify(propAtPath(object, field))
        .filter((v) => v)
        .map((v) => {
          return typeof v === 'string'
            ? v
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter((t) => t)
            : [];
        })
        .flat();
    })
    .flat();
};

function textSearchFilter(q, fields = []) {
  const textSearchTerms = q
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t)
    .map((t) => new RegExp(t, 'i'));

  if (textSearchTerms.length < 1) {
    return {};
  }

  return {
    $or: fields.map((field) => ({
      $and: textSearchTerms.map((t) => ({
        [field]: t,
      })),
    })),
  };
}
exports.textSearchFilter = textSearchFilter;

exports.validatePhone = (phone, format = 'international') => {
  return PhoneNumber(phone).isValid();
};

exports.formatPhone = (phone, format = 'international') => {
  const phoneObject = PhoneNumber(phone);

  return phoneObject.isValid()
    ? phoneObject.getNumber(format)
    : phone;
};

exports.randomChance = (p) => {
  return Math.random() > p;
};

exports.randomInt = (n) => {
  return Math.round(Math.random() * n);
};

exports.randomArray = (n, fn) => {
  return Array.from(Array(exports.randomInt(n))).map(fn);
};

exports.randomCoord = (
  name = 'location',
  p1 = [30.199651, 60.093928],
  p2 = [30.449999, 59.818431],
) => {
  const lat = p1[0] + Math.random() * (p2[0] - p1[0]);
  const lng = p1[1] + Math.random() * (p2[1] - p1[1]);

  return {
    name,
    type: 'Point',
    coordinates: [lat, lng],
  };
};

exports.addTextSearchToQuery = ({query, q, searchFields}) => {
  const textQuery = textSearchFilter(q, searchFields);

  if (query.$or) {
    query.$or = textQuery.$or.reduce((result, tq) => {
      const projection = query.$or.map((search) => ({
        ...search,
        ...tq,
      }));

      return result.concat(projection);
    }, []);
  } else {
    query.$or = textQuery.$or;
  }
};

exports.formatUpdateMark = ({createDate, messageId, chatId}) => {
  const timeStringCap = 13;

  const timeStringArray = String(createDate.valueOf()).split('');

  const zeroes = _.fill(
    Array(timeStringCap - timeStringArray.length),
    0,
  );
  const timeString = zeroes.concat(timeStringArray).join('');

  return `${timeString}|${messageId || chatId}`;
};

exports.loremIpsum = () => {
  return (
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod ' +
    'tempor incididunt ut labore et dolore magna aliqua. Neque aliquam vestibulum ' +
    'morbi blandit cursus risus at ultrices mi. Pellentesque habitant morbi tristique ' +
    'senectus. Aliquam sem fringilla ut morbi tincidunt augue. Sagittis nisl rhoncus ' +
    'mattis rhoncus urna neque. Dignissim diam quis enim lobortis scelerisque. Viverra ' +
    'nam libero justo laoreet sit amet cursus sit amet. Curabitur gravida arcu ac tortor ' +
    'dignissim convallis. Ultrices eros in cursus turpis. Fringilla ut morbi tincidunt ' +
    'augue. Et leo duis ut diam quam. Ac tortor vitae purus faucibus. Massa vitae tortor ' +
    'condimentum lacinia quis vel eros'
  );
};

exports.capitalize = (string) => {
  return string.replace(/^\w/, (c) => c.toUpperCase());
};

exports.uniqIds = (ids) => {
  return ids.filter((id1) => {
    const first = ids.find((id2) => {
      return id1.equals(id2);
    });

    return first === id1;
  });
};

exports.fileIdsFromPosts = (posts = []) => {
  return posts
    .map((post) => [post.fileIds, post.media, post.audioIds])
    .flat()
    .filter((id) => id)
    .flat();
};

exports.getDateParams = ({
                           startDate,
                           endDate,
                           isStartTimeDefined,
                           isEndTimeDefined,
                         }) => {
  const result = {};
  if (startDate) {
    const start = new Date(startDate);
    Object.assign(result, {
      originalStartDate: start,
      startYear: start.getFullYear(),
      startMonth: start.getMonth() + 1,
      startWeek: start.getDay(),
      startDay: start.getDate(),
    });
  }
  if (endDate) {
    const end = new Date(endDate);
    Object.assign(result, {
      originalEndDate: end,
      projectedEndDate: end,
      endYear: end.getFullYear(),
      endMonth: end.getMonth() + 1,
      endWeek: end.getDay(),
      endDay: end.getDate(),
    });
  } else {
    result.projectedEndDate = new Date([9999, 1, 1]);
  }

  return result;
};

exports.parseEventDates = ({
                             eventStart,
                             eventEnd,
                             isEventStartTimeDefined,
                             isEventEndTimeDefined,
                           }) => {
  const dateTemplate = 'YYYY-MM-DD';
  const dateWithTimeTemplate = 'YYYY-MM-DDThh:mm:ss.SSSZZZZ';

  eventStart = isEventStartTimeDefined
    ? moment(eventStart, dateWithTimeTemplate)
    : moment(eventStart, dateTemplate);
  eventEnd = isEventEndTimeDefined
    ? moment(eventEnd, dateWithTimeTemplate)
    : moment(eventEnd, dateTemplate);
  return {
    eventStart: +eventStart ? eventStart.toDate() : null,
    eventEnd: +eventEnd ? eventEnd.toDate() : null,
  };
};

const getWeeklyEventsCountsByMonth = (
  weeklyEvents = [],
  year,
  month,
) => {
  let count = 0;
  for (const event of weeklyEvents) {
    const startOfMonth = moment()
      .year(year)
      .month(month - 1)
      .startOf('month')
      .toDate();
    const endOfMonth = moment()
      .year(year)
      .month(month - 1)
      .endOf('month')
      .toDate();
    let eventStartDate = moment(event.startDate);
    let eventEndDate;
    if (event.endDate) {
      eventEndDate = moment(event.endDate);
    }
    if (
      !eventEndDate ||
      moment(eventEndDate).isAfter(endOfMonth)
    ) {
      eventEndDate = endOfMonth;
    }
    if (
      moment(eventStartDate).isAfter(endOfMonth) ||
      moment(eventEndDate).isBefore(startOfMonth)
    ) {
      continue;
    }
    if (moment(eventStartDate).isBefore(startOfMonth)) {
      let weekDaysDifference =
        moment(eventStartDate).day() -
        moment(startOfMonth).day();
      if (weekDaysDifference < 0) {
        weekDaysDifference = weekDaysDifference + 7;
      }
      eventStartDate = startOfMonth;
      eventStartDate = moment(eventStartDate).add(
        weekDaysDifference,
        'd',
      );
    }

    while (moment(eventStartDate).isSameOrBefore(eventEndDate)) {
      count++;
      eventStartDate = moment(eventStartDate).add(7, 'd');
    }
  }
  return count;
};

exports.getWeeklyEventsCountsByMonth = getWeeklyEventsCountsByMonth;

const getMonthEventsCountsByYear = (events = [], year) => {
  const result = [];
  events = events.filter((e) => e.startYear <= year);
  const groups = _.groupBy(events, (e) => e.repeatPeriod);
  for (let i = 1; i <= 12; i++) {
    let count = 0;
    if (groups.none) {
      count += groups.none.filter(
        (e) => e.startMonth === i && e.startYear === year,
      ).length;
    }
    if (groups.week) {
      count += getWeeklyEventsCountsByMonth(
        groups.week,
        year,
        i,
      );
    }
    if (groups.month) {
      count += groups.month.length;
    }
    if (groups.year) {
      count += groups.year.filter(
        (e) => e.startMonth === i,
      ).length;
    }
    result.push({
      month: i,
      count,
    });
  }
  return result;
};
exports.getMonthEventsCountsByYear = getMonthEventsCountsByYear;

const getMonthsEventCountsByYearRange = (
  events,
  from = new Date().getFullYear() - 10,
  to = new Date().getFullYear() + 10,
) => {
  const result = [];
  for (let year = from; year <= to; year++) {
    result.push({
      year,
      months: getMonthEventsCountsByYear(events, year),
    });
  }
  return result;
};
exports.getMonthsEventCountsByYearRange =
  getMonthsEventCountsByYearRange;

exports.arrayStringsToObjectIds = (arr = []) =>
  arr.filter(ObjectId.isValid).map(ObjectId);

exports.formatUrl = url.format;

exports.sendRequest = (method, url) => {
  const headers = {
    'Content-Type': 'application/json',
  };
  const options = {
    method,
    headers,
  };
  return fetch(url, options).then((response) => {
    if (response.ok) {
      return response.json();
    }

    return response.json().then((error) => {
      const e = new Error('some err');
      e.data = error;
      throw e;
    });
  });
};

exports.getCountries = () => _.values(isoToGcal);

exports.getIsoByGCalCountry = (country) =>
  (_.invert(isoToGcal)[country] || '').toUpperCase();

exports.getCountryIsoFromPhone = (phone) => {
  try {
    return PhoneNumber(phone).getRegionCode();
  } catch (err) {
    return null;
  }
};

exports.modifiedFields = (original, update) => {
  const modified = {};

  for (const key of Object.keys(update)) {
    if (!_.isEqual(original[key], update[key])) {
      modified[key] = _.cloneDeep(update[key]);
    }
  }

  return modified;
};

exports.getUserDateByTimezone = (timezoneOffset) => {
  const currentDateMs = new Date().getTime();

  const userCurrentDate = new Date(
    currentDateMs + timezoneOffset * 60 * 1000,
  );
  const userCurrentDateMs = userCurrentDate.getTime();

  return {
    userCurrentDate,
    userCurrentDateMs,
  };
};

exports.getTimeZones = () => {
  const hours = new Date().getHours();
  const minutes = new Date().getMinutes();
  const plusHoursForMidnight = 24 - hours;
  return [
    plusHoursForMidnight * 60 + (minutes >= 30 ? 30 : 0),
    -(hours * 60 + (minutes >= 30 ? 30 : 0)),
  ];
};

exports.setYear = ({date = new Date(), year = 2020}) =>
  moment(date).set('year', year).toDate();

exports.deleteDuplicateObjectId = (items) => {
  return items.filter(
    (item, index) =>
      !items.slice(index + 1).find((elem) => elem.equals(item)),
  );
};

exports.getObjectIdsFromArray = (array = []) =>
  array.map((item) => ObjectId(item._id));

exports.setTimeFromDate = (timeOfString, timezone) => {
  const {hours, minutes} = parseTime(timeOfString);
  return moment().tz(timezone).set({hours, minutes});
};

exports.getDifferenceIds = (array = [], values = []) =>
  _.differenceBy(array, values, (id) => id.toString());

exports.addDaysToDate = ({date, daysCount = 0}) => {
  if (!date) {
    return null;
  }
  return moment(date).add(daysCount, 'days');
};

exports.sortArray = (items = [], sort) => {
  if (!sort) {
    return items;
  }

  const iteratees = sort.split(',').map((s) => s.replace(/^-/, ''));
  const orders = sort
    .split(',')
    .map((s) => (/^-/.test(s) ? 'desc' : 'asc'));

  return _.orderBy(items, iteratees, orders);
};

exports.getKeyWordsQuery = (q) => ({
  $in: [new RegExp(`${q}`, 'i')],
});

const mergeObjectsByFields = (
  fields = [],
  object = {},
  source = {},
) => {
  const isObjects = _.isObject(object) && _.isObject(source);
  const isArray = _.isArray(object) || _.isArray(source);

  if (!isObjects || isArray) {
    return _.isObject(source)
      ? source
      : _.isObject(object)
        ? object
        : {};
  }

  const from = _.clone(object);
  const to = _.clone(source);

  _.mapKeys(from, (value, key) => {
    if (
      _.isObject(value) &&
      !ObjectId.isValid(value) &&
      !_.isDate(value)
    ) {
      to[key] = mergeObjectsByFields(
        _.keys(value).concat(_.keys(to[key])),
        value,
        to[key],
      );
    }
  });

  return _.merge(
    _.pickBy(_.pick(from, fields), Boolean),
    _.pickBy(_.pick(to, fields), Boolean),
  );
};

exports.mergeObjectsByFields = mergeObjectsByFields;

exports.findOneAndDistinctArrayOfObjects = (
  field,
  collection = [],
  predicate,
) => {
  const element = _.find(collection, predicate) || {};
  return element[field] || null;
};

exports.hashKeyToObjectId = (string) => {
  const hash = crypto
    .createHash('md5')
    .update('unknown')
    .digest('hex')
    .substr(0, 24);

  return ObjectId(hash);
};

exports.flatAndSliceArrays = (end, ...arrays) => {
  return _.slice(arrays.flat().filter(Boolean), 0, end);
};

exports.arrayOfObjectIdsIncludesOId = ({objectIds = [], id}) => {
  if (!objectIds.length || !id) {
    return false;
  }

  const result = objectIds
    .filter(ObjectId.isValid)
    .find((oid) => oid.equals(id));

  return Boolean(result);
};

exports.convertObjectToBase64 = (object) => {
  if (!object) {
    return false;
  }

  const stringifyObject = JSON.stringify(object);

  return Buffer.from(stringifyObject).toString('base64');
};

exports.convertBase64ToObject = (buffer) => {
  if (!buffer) {
    return false;
  }

  const decode = Buffer.from(buffer, 'base64').toString();

  return JSON.parse(decode);
};
