require('dotenv').config();
const express = require('express');
const cors = require('cors');


const app = express();

// ✅ THIS MUST BE HERE (BEFORE your routes)
app.use(cors());
app.use('/api/agent/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());   // <-- This line is critical
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;

// Routes
app.use('/api/agent', require('./routes/agent'));

app.get('/', (req, res) => {
    res.send('Revenue Agent is running...');
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;