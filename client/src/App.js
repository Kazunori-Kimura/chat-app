import React, { Component } from 'react';
import './App.css';

/*
  接続するWebSocketのURL
  httpsの場合は wss://~~~ となる 
 */
const SOCKET_URL = 'ws://localhost:8080';

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      from: '',
      to: '',
      message: '',
      connected: false,
      messages: [],
    };

    this.socket = null;

    this.handleChange = this.handleChange.bind(this);
    this.handleConnect = this.handleConnect.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.handleSend = this.handleSend.bind(this);
  }

  componentDidMount() {
    /*
      切断処理は神経質にやる必要はないです
      クライアントのsocket接続が見えなくなると
      サーバー側は自動的に接続を破棄します
     */
    if (this.socket) {
      this.socket.close();
    }
  }

  handleChange(evt) {
    const { name, value } = evt.target;
    const obj = {};
    obj[name] = value;

    this.setState(obj);
  }

  validateConnect() {
    const { from, to } = this.state;
    const re = /^[0-9]+$/;
    return re.test(from) && re.test(to);
  }

  handleConnect() {
    const { from, to } = this.state;

    // URLを指定してWebSocketのインスタンスを生成
    // (ライブラリを使わず、生のWebSocketを使用)
    this.socket = new WebSocket(SOCKET_URL);

    // 接続イベント
    this.socket.addEventListener('open', () => {
      // WebSocketサーバーに接続したら
      // 自身とチャット相手のuser_idをサーバーに伝えます
      // TODO: 認証のため、ログイン時に取得したトークンも渡す
      this.socket.send(JSON.stringify({
        type: 'open',
        data: [from, to],
      }));

      this.setState({
        connected: true,
      });
    });

    // 切断イベント
    this.socket.addEventListener('close', () => {
      // サーバー側から切断された
      this.setState({
        connected: false,
      });
    });

    // 受信イベント
    this.socket.addEventListener('message', (evt) => {
      const { messages } = this.state;

      // 受信データは event.data に文字列で格納されます
      const { data } = evt;
      const message = JSON.parse(data);
      console.log(message);

      if (message.type === 'message') {
        /*
          メッセージ
          {
            type: 'message',
            message: {
              message_id: <string>, // 未読管理で使用
              user_id: <number>, // 発言者のuser_id
              message: <string>, // メッセージ本文
              date: <string>, // UTC
            }
          }
         */
        // JSON.parse一発ではmessageがobjectに変換されないので
        // もう一度変換する
        const msg = JSON.parse(message.message);

        // messagesの末尾に追加
        this.setState({
          messages: [...messages, msg],
        });
      } else if (message.type === 'history') {
        /*
          会話履歴
          {
            type: 'history',
            messages: [
              {
                message_id: <string>, // 未読管理で使用
                user_id: <number>, // 発言者のuser_id
                message: <string>, // メッセージ本文
                date: <string>, // UTC
              },
            ]
          }
         */
        const msgs = [];
        message.messages.forEach((message) => {
          // JSON.parse一発ではmessageがobjectに変換されないので
          // もう一度変換する
          const msg = JSON.parse(message);
          msgs.push(msg);
        });

        // messagesを入れ替え
        this.setState({
          messages: msgs,
        });
      }
    });
  }

  handleDisconnect() {
    if (this.socket) {
      try {
        // 切断
        this.socket.close();
      } catch (err) {
        console.log(err);
      }

      this.setState({
        connected: false,
      });
    }
  }

  handleSend() {
    const { from, message } = this.state;
    if (this.socket) {
      /*
        サーバーへのメッセージ送信は以下の形式
        JSON.stringifyで文字列に変換してください

        message_id,投稿日はサーバー側で設定します

        {
          type: 'send',
          data: {
            user_id: <number>, // 発言者のユーザーID
            message: <string>, // メッセージ本文
          }
        }
       */
      this.socket.send(JSON.stringify({
        type: 'send',
        data: {
          user_id: from, // 自分のユーザーID
          message, // メッセージ
        }
      }));

      // message領域をクリア
      this.setState({
        message: '',
      });
    }
  }

  renderMessage(item) {
    const { user_id, message, date } = item;
    return (
      <div
        className="list-item"
        key={`key_${user_id}_${date}`}
      >
        <div className="list-item-header">
          <span>{user_id}</span>
          <span>{date}</span>
        </div>
        <div className="list-item-body">
          {message}
        </div>
      </div>
    );
  }

  renderMessages(list) {
    return (
      <div className="list">
        {list.map(item => this.renderMessage(item))}
      </div>
    );
  }

  render() {
    return (
      <div className="App">
        <div className="header">
          <input type="text"
            placeholder="from" name="from"
            value={this.state.from}
            disabled={this.state.connected}
            onChange={this.handleChange}
          />
          <input type="text"
            placeholder="to" name="to"
            value={this.state.to}
            disabled={this.state.connected}
            onChange={this.handleChange}
          />
          <button
            disabled={this.state.connected && this.validateConnect()}
            onClick={this.handleConnect}
          >
            connect
          </button>
          <button
            disabled={!this.state.connected}
            onClick={this.handleDisconnect}
          >
            disconnect
          </button>
        </div>
        {this.renderMessages(this.state.messages)}
        <div className="footer">
          <textarea
            placeholder="message" name="message"
            value={this.state.message}
            onChange={this.handleChange}
          />
          <button
            disabled={!this.state.connected || this.state.message === ''}
            onClick={this.handleSend}
          >
            send
          </button>
        </div>
      </div>
    );
  }
}

export default App;
