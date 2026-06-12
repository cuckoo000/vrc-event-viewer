// イベントビューアの設定
// apiUrl: event-viewer-api（GAS Webアプリ）のデプロイURL（.../exec）
//         dev検証時は dev のURL、本番公開時は prod のURLを設定する
// calendarUrl: フッターからリンクするGoogleカレンダー（埋め込みページ）のURL
// dev : https://script.google.com/macros/s/AKfycbzrMMTRST_lj0S8oT8re4lRpZ9oR17DSkVDqHyvkIvjvAyswa0IKwoyovDvvy2LxzYe/exec
// prod: https://script.google.com/macros/s/AKfycbzuycV_btb7jI1C7beGw3GMZBQth7Ii01eXeHFJ5X6ejss6ABNmaWluiAWmmpLFjcBT9A/exec
window.VRC_EVENT_VIEWER_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbzuycV_btb7jI1C7beGw3GMZBQth7Ii01eXeHFJ5X6ejss6ABNmaWluiAWmmpLFjcBT9A/exec',
  calendarUrl: 'https://calendar.google.com/calendar/embed?src=0058cd78d2936be61ca77f27b894c73bfae9f1f2aa778a762f0c872e834ee621%40group.calendar.google.com&ctz=Asia%2FTokyo'
};
