require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').Server(app);
const WebSocketServer = require('ws').Server;
const ws = new WebSocketServer({ server: http });
const Redis = require('ioredis');

const PORT = process.env.PORT || 3000;
const REDIS_ADDRESS = process.env.REDIS_ADDRESS || 'redis://127.0.0.1:6379';
const CHANNEL_HISTORY_MAX = 10;
const MESSAGE_TYPE = {
  OPEN: 'open',
  SEND: 'send',
};

/*
  チャット接続

  key: WebSocket
  value: {
    client: <Redis>, // Redisのsubscribe用インスタンス
    room: <String>, // チャットルーム名
    channel: <String>, // Redis PubSub Channel名
    users: <Number[]> // チャットユーザーID
  }
 */
const connections = new Map();

// Redisインスタンス
// redis操作およびmessageのpublishに使用
const redis = new Redis(REDIS_ADDRESS);

// AWSヘルスチェック
app.get('/health', (req, res) => {
  res.send('ok');
});

// WebSocketの接続
ws.on('connection', (socket) => {
  // メッセージの受信
  socket.on('message', (message) => {
    /*
      message = {
        type: 'open' or 'send'
        data: any
      }
     */
    const { type, data } = JSON.parse(message);

    if (type === MESSAGE_TYPE.OPEN) {
      // data = [id:<number>, id:<number>]
      addConnection(socket, data);
    } else if (type === MESSAGE_TYPE.SEND) {
      // data = { user_id:<number>, message:<string> }
      sendMessage(socket, data);
    }
  });

  // 切断
  socket.on('close', () => {
    deleteConnection(socket);
  });
});

/**
 * 接続を追加
 * @param {WebSocket} socket 
 * @param {Number[]} data 
 */
function addConnection(socket, data) {
  console.log('addConnection: ', data);

  // dataが配列でなければ終了
  if (!(Array.isArray(data) && data.length === 2)) {
    return;
  }

  try {
    // すでに同じWebSocketでチャットを開始していたら
    // 該当のconnectionを削除
    deleteConnection(socket);

    // TODO: 認証処理
    // 認証に失敗したらsocket切断する

    // チャットしているユーザー
    const users = data.sort((a, b) => {
      const aVal = parseInt(a, 10);
      const bVal = parseInt(b, 10);
      return aVal - bVal;
    });
    // チャットルーム名
    const room = `room:${users.join('-')}`;
    // PubSubチャンネル名
    const channel = `channel/${room}`;

    // PubSubに使用するRedisインスタンス
    // subscribeに使うインスタンスはredis操作やpublishするインスタンスと
    // 分けて生成します
    const client = new Redis(REDIS_ADDRESS);
    client.subscribe(channel);

    // メッセージ受信
    client.on('message', (channelName, message) => {
      /*
        socketに受信messageを渡す

        {
          type: 'message',
          message: {
            uuid,
            user_id,
            message,
            date
          }
        }
       */
      socket.send(JSON.stringify({ type: 'message', message }));
    });

    // connectionを保持
    connections.set(socket, { client, channel, room, users });

    // Redisから過去のメッセージを取り出す
    redis.zrange(room, -1 * CHANNEL_HISTORY_MAX, -1)
      .then((result) => {
        if (result) {
          socket.send(JSON.stringify({ type: 'history', messages: result }));
        }
      })
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    console.error(err);
  }
}

/**
 * メッセージ送信
 * @param {WebSocket} socket 
 * @param {Object} message 
 */
function sendMessage(socket, message) {
  console.log('sendMessage: ', message);

  try {
    const { room, channel } = connections.get(socket);
    // TODO: message_idを採番
    // message_id = `${room}/${uuid}`

    // メッセージに投稿日時を追加
    const date = new Date();
    const msg = Object.assign({}, message, { date: date.toJSON() });
    const data = JSON.stringify(msg);

    // redisに保持
    redis.zadd(room, date.getTime(), data);
    // Publish
    redis.publish(channel, data);

    // TODO: 未読setにuuidを登録
    // key: `unread:${user_id}`
    // type: set
    // value: message_id

    // zsetから古い項目を削除する
    redis.zrange(room, 0, CHANNEL_HISTORY_MAX, 'WITHSCORES')
      .then((items) => {
        if (items.length > CHANNEL_HISTORY_MAX) {
          const item = items[CHANNEL_HISTORY_MAX - 1];
          // itemよりscoreが小さい項目 (過去のメッセージ) を削除する
          try {
            redis.zremrangebyscore(room, 0, item.score - 1);
            // TODO: 未読メッセージからも削除する必要があるので
            // ひとつづつ取り出す必要あり
          } catch (err) {
            console.error(err);
          }
        }
      })
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    console.error(err);
  }
}

/**
 * 接続を削除する
 * @param {WebSocket} socket 
 */
function deleteConnection(socket) {
  try {
    if (connections.has(socket)) {
      console.log('deleteConnection');

      const { client, channel } = connections.get(socket);
      // Redisのsubscribeを解除
      client.unsubscribe(channel);
      // Mapから削除
      connections.delete(socket);
    }
  } catch (err) {
    console.error(err);
  }
}


http.listen(PORT, () => {
  console.log('Started server on port:', PORT);
});
