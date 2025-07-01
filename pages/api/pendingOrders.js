<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订单系统</title>
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="订单系统">
  <style>
    body {
      background: #f8f8f8;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 30px;
    }
    img {
      width: 120px;
      margin-bottom: 20px;
    }
    button {
      font-size: 20px;
      padding: 14px 28px;
      margin: 12px auto;
      border: none;
      border-radius: 12px;
      background-color: #2e7d32;
      color: white;
      display: block;
      width: 260px;
      box-shadow: 2px 2px 10px rgba(0,0,0,0.2);
    }
    .order {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
      padding: 16px;
      margin: 20px auto;
      width: 90%;
      max-width: 500px;
      text-align: left;
    }
    .order pre {
      font-size: 14px;
      white-space: pre-wrap;
    }
    .send-btn {
      margin-top: 10px;
      background: #c62828;
    }
  </style>
</head>
<body>
  <img src="/apple-touch-icon.png" alt="Logo">
  <button onclick="location.href='/api/startOrderListener'">🌱 记录商品资料</button>
  <button onclick="loadOrders()">📋 显示待发订单</button>
  <button onclick="location.href='/api/exportOrders'">📤 导出订单 Excel</button>

  <div id="orderList"></div>
  <script>
    async function loadOrders() {
      const res = await fetch('/api/pendingOrders');
      const orders = await res.json();
      const grouped = {};

      for (const order of orders) {
        const name = order.user_name || '匿名用户';
        if (!grouped[name]) grouped[name] = [];
        grouped[name].push(order);
      }

      const container = document.getElementById('orderList');
      container.innerHTML = '';

      if (orders.length === 0) {
        container.innerHTML = '<p>暂无待发订单</p>';
        return;
      }

      for (const [name, items] of Object.entries(grouped)) {
        let total = 0;
        let msg = `${name}\n`;

        for (const item of items) {
          const qty = parseInt(item.quantity) || 1;
          const price = parseFloat(item.price) || 0;
          const subtotal = qty * price;
          total += subtotal;
          msg += `${item.selling_id} ${item.product_name} ${qty} x ${price.toFixed(2)}\n`;
        }

        msg += `合计：RM ${total.toFixed(2)}\n\n`;
        msg += `Lover Legend Adenium\nMaybank 512389673060\nPublic Bank 3214928526\n\nTNG link\nhttps://payment.tngdigital.com.my/sc/dRacq2iFOb`;

        const div = document.createElement('div');
        div.className = 'order';
        div.innerHTML = `<pre>${msg}</pre><button class='send-btn' onclick='sendLink("${items[0].comment_id}")'>发送付款连接</button>`;
        container.appendChild(div);
      }
    }

    async function sendLink(comment_id) {
      const res = await fetch(`/api/manualSend?comment_id=${comment_id}`);
      const data = await res.json();
      alert(data.message || '已尝试发送');
      loadOrders();
    }
  </script>
</body>
</html>
