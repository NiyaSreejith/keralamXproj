const postgres = require('postgres');

const allowedPlaces = new Set([
  'kozhikode',
  'kochi',
  'trivandrum',
  'wayanad',
  'palakkad',
  'munnar',
  'alappuzha',
  'varkala',
  'kumarakom'
]);

const allowedTypes = new Set([
  'Iconic Legend',
  'Traditional',
  'Street Food',
  'Heritage Spot',
  'Local Explorer'
]);

let sql;
let schemaReady = false;

function getConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

function getSql() {
  if (!sql) {
    const connectionString = getConnectionString();

    if (!connectionString) {
      throw new Error('Missing DATABASE_URL or POSTGRES_URL environment variable.');
    }

    sql = postgres(connectionString, {
      max: 1,
      ssl: 'require'
    });
  }

  return sql;
}

async function ensureSchema() {
  if (schemaReady) return;

  await getSql()`
    CREATE TABLE IF NOT EXISTS food_spots (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      dish TEXT NOT NULL,
      history TEXT NOT NULL,
      type TEXT NOT NULL,
      place_key TEXT NOT NULL,
      lat_offset DOUBLE PRECISION NOT NULL,
      lng_offset DOUBLE PRECISION NOT NULL,
      emotional_tag TEXT NOT NULL DEFAULT 'comfort',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  schemaReady = true;
}

function toClientSpot(row) {
  return {
    id: `db-${row.id}`,
    name: row.name,
    dish: row.dish,
    history: row.history,
    type: row.type,
    placeKey: row.place_key,
    latOffset: row.lat_offset,
    lngOffset: row.lng_offset,
    emotionalTag: row.emotional_tag
  };
}

function cleanText(value, fieldName, maxLength) {
  const text = String(value || '').trim();

  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }

  if (text.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  try {
    if (!getConnectionString()) {
      return sendJson(res, 503, {
        error: 'Database is not connected. Add a Vercel Marketplace Postgres database to this project.'
      });
    }

    await ensureSchema();

    if (req.method === 'GET') {
      const rows = await getSql()`
        SELECT id, name, dish, history, type, place_key, lat_offset, lng_offset, emotional_tag
        FROM food_spots
        ORDER BY created_at ASC, id ASC
      `;

      return sendJson(res, 200, { spots: rows.map(toClientSpot) });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const name = cleanText(body.name, 'Eatery name', 120);
      const dish = cleanText(body.dish, 'Signature dish', 160);
      const history = cleanText(body.history, 'Cultural context', 500);
      const type = cleanText(body.type, 'Category', 60);
      const placeKey = cleanText(body.placeKey, 'Location', 40);

      if (!allowedTypes.has(type)) {
        return sendJson(res, 400, { error: 'Unsupported category.' });
      }

      if (!allowedPlaces.has(placeKey)) {
        return sendJson(res, 400, { error: 'Unsupported location.' });
      }

      const rows = await getSql()`
        INSERT INTO food_spots (
          name,
          dish,
          history,
          type,
          place_key,
          lat_offset,
          lng_offset,
          emotional_tag
        )
        VALUES (
          ${name},
          ${dish},
          ${history},
          ${type},
          ${placeKey},
          ${(Math.random() - 0.5) * 0.012},
          ${(Math.random() - 0.5) * 0.012},
          ${body.emotionalTag || 'comfort'}
        )
        RETURNING id, name, dish, history, type, place_key, lat_offset, lng_offset, emotional_tag
      `;

      return sendJson(res, 201, { spot: toClientSpot(rows[0]) });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);

    return sendJson(res, 500, {
      error: 'Unable to process food spot request.'
    });
  }
};
