const express = require('express');
const mysql = require('mysql2');
const WebSocket = require('ws');
const app = express();
const PORT = 3000;

// MySQL bağlantısı
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', 
    password: 'Cemal.1420', 
    database: 'kurye_sistemi',
});

// MySQL bağlantısını kontrol et
db.connect((err) => {
    if (err) {
        console.error('MySQL bağlantısı sağlanamadı:', err);
        return;
    }
    console.log('MySQL bağlantısı sağlandı!');
});

// WebSocket sunucusu oluştur
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('Yeni bir kurye bağlandı.');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'NEW_ORDER':
                handleNewOrder(data);
                break;
            case 'TAKE_ORDER':
                handleTakeOrder(data, ws);
                break;
            case 'DELIVER_ORDER':
                handleDeliverOrder(data, ws);
                break;
            case 'CANCEL_ORDER':
                handleCancelOrder(data, ws);
                break;
            case 'GET_CURRENT_ORDERS':
                handleGetCurrentOrders(ws);
                break;
            case 'GET_STATS':
                handleGetStats(ws);
                break;
            default:
                console.log('Bilinmeyen mesaj tipi:', data.type);
        }
    });
});

// Yeni sipariş geldiğinde
function handleNewOrder(data) {
    // Siparişi doğrudan 'in_progress' durumuyla ekleyin
    db.query('INSERT INTO orders (address, store, status) VALUES (?, ?, ?)', [data.address, data.store, 'in_progress'], (err, results) => {
        if (err) {
            console.error('Sipariş eklenemedi:', err);
            return;
        }

        const newOrder = {
            id: results.insertId,
            address: data.address,
            store: data.store,
            status: 'in_progress'  // Durumu burada 'in_progress' olarak ayarlayın
        };

        const orderMessage = JSON.stringify({ type: 'ORDER_ADDED', order: newOrder });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(orderMessage);
            }
        });
    });
}

// Sipariş alma
function handleTakeOrder(data, ws) {
    db.query('UPDATE orders SET courier_id = ?, status = ? WHERE id = ?', [data.courierId, 'in_progress', data.id], (err) => {
        if (err) {
            console.error('Sipariş alınamadı:', err);
            return;
        }

        const orderMessage = JSON.stringify({ type: 'ORDER_TAKEN', id: data.id });
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(orderMessage);
            }
        });
    });
}

// Siparişi teslim etme
function handleDeliverOrder(data, ws) {
    db.query('UPDATE orders SET status = ? WHERE id = ?', ['delivered', data.id], (err) => {
        if (err) {
            console.error('Sipariş teslim edilemedi:', err);
            return;
        }

        const deliveryMessage = JSON.stringify({ type: 'ORDER_DELIVERED', id: data.id });
        ws.send(deliveryMessage);
    });
}

// Siparişi iptal etme
function handleCancelOrder(data, ws) {
    db.query('DELETE FROM orders WHERE id = ?', [data.id], (err) => {
        if (err) {
            console.error('Sipariş silinemedi:', err);
            return;
        }

        const cancelMessage = JSON.stringify({ type: 'ORDER_CANCELLED', id: data.id });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(cancelMessage);
            }
        });
    });
}

// Mevcut siparişleri alma
function handleGetCurrentOrders(ws) {
    db.query('SELECT * FROM orders WHERE status = "in_progress"', (err, results) => {
        if (err) {
            console.error('Siparişler alınamadı:', err);
            return;
        }

        const currentOrdersMessage = JSON.stringify({ type: 'CURRENT_ORDERS', orders: results });
        ws.send(currentOrdersMessage);
    });
}

// Yöneticiler için istatistikler
function handleGetStats(ws) {
    const storeOrdersQuery = 'SELECT restaurant_id, COUNT(*) AS total_orders FROM orders GROUP BY restaurant_id';
    const courierDeliveriesQuery = 'SELECT courier_id, COUNT(*) AS total_deliveries FROM orders WHERE status = "delivered" GROUP BY courier_id';

    db.query(storeOrdersQuery, (err, storeOrders) => {
        if (err) {
            console.error('Mağaza istatistikleri alınamadı:', err);
            return;
        }

        db.query(courierDeliveriesQuery, (err, courierDeliveries) => {
            if (err) {
                console.error('Kurye istatistikleri alınamadı:', err);
                return;
            }

            const statsMessage = JSON.stringify({
                type: 'STATS',
                storeStats: storeOrders.reduce((acc, row) => {
                    acc[row.restaurant_id] = row.total_orders;
                    return acc;
                }, {}),
                courierStats: courierDeliveries.reduce((acc, row) => {
                    acc[row.courier_id] = { total_deliveries: row.total_deliveries };
                    return acc;
                }, {})
            });

            ws.send(statsMessage);
        });
    });
}

// HTTP sunucusu başlatma
const server = app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor...`);
});

// WebSocket sunucusunu HTTP sunucusuna bağlama
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
