require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SQUARE_ENV = process.env.SQUARE_ENV || 'sandbox';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const SQUARE_BASE = SQUARE_ENV === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

// Helper to call Square APIs
async function squareFetch(path, method = 'GET', body) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// Example: create a Square customer (optional)
// POST body: { given_name, family_name, email_address, phone_number }
app.post('/create-customer', async (req, res) => {
  try {
    const body = req.body;
    const data = await squareFetch('/v2/customers', 'POST', body);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'create-customer failed' });
  }
});

// Main endpoint: Servis.ai calls this to create & publish an invoice
// Expected JSON body: { customer_id, amount, currency, description, due_date }
app.post('/create-square-invoice', async (req, res) => {
  try {
    const { customer_id, amount, currency = 'USD', description = '', due_date } = req.body;
    if (!customer_id || !amount) return res.status(400).json({ error: 'customer_id and amount required' });

    // 1) Create an invoice draft with a payment_request
    const invoiceBody = {
      invoice: {
        location_id: LOCATION_ID,
        title: "Servis.ai Invoice",
        description,
        primary_recipient: { customer_id },
        payment_requests: [
          {
            request_type: "BALANCE",
            due_date: due_date || null, // format YYYY-MM-DD
            fixed_amount_requested_money: {
              amount: Math.round(Number(amount) * 100),
              currency
            }
          }
        ],
        // optional: accept payments via Square
        delivery_method: "EMAIL"
      }
    };

    const createResp = await squareFetch('/v2/invoices', 'POST', invoiceBody);
    if (createResp.errors) {
      return res.status(500).json({ error: 'invoice create failed', details: createResp });
    }

    // 2) Publish invoice so email is sent (or keep draft if you want manual publishing)
    const invoiceId = createResp.invoice.id;
    const publishBody = {
      invoice_version: createResp.invoice.version
    };

    const publishResp = await squareFetch(`/v2/invoices/${invoiceId}/publish`, 'POST', publishBody);

    // Return both responses for debugging
    res.json({ create: createResp, publish: publishResp });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'create-square-invoice failed', details: err.message });
  }
});

// Square webhook receiver (configure this URL in Square Developer dashboard)
app.post('/square/webhook', (req, res) => {
  // Validate signature in production (Square sends signature header)
  console.log('Square webhook received:', req.headers['x-square-event-type']);
  // Example: forward to Servis.ai or update DB
  res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`Square base: ${SQUARE_BASE}`);
});
