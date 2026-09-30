/**
 * 云服务公开配置。
 *
 * 这两个值来自应用开通云服务时返回的 publicConfig —— 是唯一合法的来源，
 * 不要改成别的域名，也不要从别处推断。endpoint 必须是环境固定的网关地址
 * （小程序没有 Origin，靠微信的请求域名白名单鉴权，所有小程序共用这一个网关）。
 */
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_n1XWNggmfXP7Ayb9MgihId_Czuc4zRZMzVw2U7pgrhoxksa6dYo1QjS',
}

module.exports = { publicConfig }
