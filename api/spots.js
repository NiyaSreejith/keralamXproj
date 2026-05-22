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

const adminProfile = {
  name: 'niya sreejith',
  email: 'niya12@gmail.com',
  region: 'malabar'
};

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
      owner_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await getSql()`
    ALTER TABLE food_spots
    ADD COLUMN IF NOT EXISTS owner_key TEXT
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

function normalizeAdminValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isAdminRequest(body, requestUrl, req) {
  const name = normalizeAdminValue(
    (req.query && req.query.adminName) ||
    requestUrl.searchParams.get('adminName') ||
    body.adminName
  );
  const email = normalizeAdminValue(
    (req.query && req.query.adminEmail) ||
    requestUrl.searchParams.get('adminEmail') ||
    body.adminEmail
  );
  const region = normalizeAdminValue(
    (req.query && req.query.adminRegion) ||
    requestUrl.searchParams.get('adminRegion') ||
    body.adminRegion
  );

  return (
    name === adminProfile.name &&
    email === adminProfile.email &&
    region === adminProfile.region
  );
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
      const ownerKey = String(body.ownerKey || '').trim().slice(0, 120);

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
          emotional_tag,
          owner_key
        )
        VALUES (
          ${name},
          ${dish},
          ${history},
          ${type},
          ${placeKey},
          ${(Math.random() - 0.5) * 0.012},
          ${(Math.random() - 0.5) * 0.012},
          ${body.emotionalTag || 'comfort'},
          ${ownerKey || null}
        )
        RETURNING id, name, dish, history, type, place_key, lat_offset, lng_offset, emotional_tag
      `;

      return sendJson(res, 201, { spot: toClientSpot(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const requestUrl = new URL(req.url, 'http://localhost');
      const rawId = (req.query && req.query.id) || requestUrl.searchParams.get('id') || '';
      const body = parseBody(req);
      const isAdmin = isAdminRequest(body, requestUrl, req);
      const ownerKey = String(
        (req.query && req.query.ownerKey) ||
        requestUrl.searchParams.get('ownerKey') ||
        body.ownerKey ||
        ''
      ).trim();
      const id = String(rawId).replace(/^db-/, '');

      if (!/^\d+$/.test(id)) {
        return sendJson(res, 400, { error: 'A valid food spot id is required.' });
      }

      if (!isAdmin && !ownerKey) {
        return sendJson(res, 403, { error: 'Only the explorer who added this spot can delete it.' });
      }

      const rows = isAdmin
        ? await getSql()`
          DELETE FROM food_spots
          WHERE id = ${Number(id)}
          RETURNING id
        `
        : await getSql()`
          DELETE FROM food_spots
          WHERE id = ${Number(id)}
            AND owner_key = ${ownerKey}
          RETURNING id
        `;

      if (rows.length === 0) {
        return sendJson(res, 404, { error: 'Food spot was not found or cannot be deleted by this explorer.' });
      }

      return sendJson(res, 200, { deleted: `db-${rows[0].id}` });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);

    return sendJson(res, 500, {
      error: 'Unable to process food spot request.'
    });
  }
};
