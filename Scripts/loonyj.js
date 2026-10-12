/**
 * 实时油价信息（仅兼容 Loon）
 * 改自 https://raw.githubusercontent.com/RS0485/network-rules/main/scripts/gas-price.js
 *
 * 数据来源：http://m.qiyoujiage.com/ 移动版页面，抓取当地油价和下次调价提示
 *
 * 插件参数（$argument，见 Plugins/OilPrice.plugin）：
 *   region  地区，默认 zhejiang。填省份拼音；同名地区填网站上的路径，
 *           如 http://m.qiyoujiage.com/shanxi-3/xian.shtml 填 shanxi-3/xian
 *
 * 通知格式：
 *   标题  下次10月15日24时调整 ↓ 0.11-0.14元/L
 *   正文  92/95/98 号汽油、0 号柴油的当前价格
 *
 * 调价说明：国内油价每 10 个工作日一个调价窗口，窗口日 24 时生效；
 *   涨跌不足 50 元/吨则本轮不调（搁浅）。网站给出的幅度是按当前国际油价
 *   推算的预计值，窗口前仍可能变化，脚本只负责展示，不做计算。
 */

// Loon 插件 [Argument] 传入的参数，以对象形式出现
const ARG = typeof $argument === "object" && $argument !== null ? $argument : {};
// 去掉首尾空格、斜杠以及误填的 .shtml 后缀
const region =
  String(ARG.region || "zhejiang")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.shtml$/, "") || "zhejiang";

// 例如 http://m.qiyoujiage.com/zhejiang.shtml
const query_addr = `http://m.qiyoujiage.com/${region}.shtml`;

$httpClient.get(
  {
    url: query_addr,
    headers: {
      referer: "http://m.qiyoujiage.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    },
  },
  (error, response, data) => {
    if (error) {
      console.log(`解析油价信息失败, URL=${query_addr}, Error: ${error}`);
      $notification.post("油价查询", "请求失败", "请检查网络连接");
      $done({});
    } else {
      // 解析当前油价：页面里每个 <dl> 对应一个油品，<dt> 为名称，<dd> 为价格
      // 正常应解析出 4 项：92/95/98 号汽油、0 号柴油
      const reg_price =
        /<dl>[\s\S]+?<dt>(.*油)<\/dt>[\s\S]+?<dd>(.*)\(元\)<\/dd>/gm;

      var prices = [];
      var m = null;

      while ((m = reg_price.exec(data)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === reg_price.lastIndex) {
          reg_price.lastIndex++;
        }

        prices.push({
          name: m[1],
          value: `${m[2]} 元/L`,
        });
      }

      // 解析下次调价提示，页面结构：
      //   <div class="tishi"> <span>下次油价10月15日24时调整</span><br/>目前预计下调油价...<br/>
      // adjust_date  调价窗口，如“10月15日24时”
      // adjust_trend 方向：↑ 上调 / ↓ 下调 / — 搁浅 / 空字符串 无法识别
      // adjust_value 预计幅度，优先取“元/升”区间，否则取“元/吨”
      var adjust_date = "";
      var adjust_trend = "";
      var adjust_value = "";

      const reg_adjust_tips =
        /<div class="tishi"> <span>(.*)<\/span><br\/>([\s\S]+?)<br\/>/;
      const adjust_tips_match = data.match(reg_adjust_tips);

      if (adjust_tips_match && adjust_tips_match.length === 3) {
        // “下次油价10月15日24时调整” → 取“价”之后、去掉末尾“调整”两个字
        adjust_date = adjust_tips_match[1].split("价")[1].slice(0, -2);

        adjust_value = adjust_tips_match[2];

        // 先判断搁浅（不足 50 元/吨不调），再判断涨跌方向
        // 搁浅时网站可能仍给出“xx元/吨”的累计幅度，必须优先判断，避免误显示为涨跌
        // 都匹配不到时箭头留空，不再默认显示 ↑
        if (/搁浅|不调|不作调整|不做调整/.test(adjust_value)) {
          adjust_trend = "—";
        } else if (/下调|下跌|下降/.test(adjust_value)) {
          adjust_trend = "↓";
        } else if (/上调|上涨|上升/.test(adjust_value)) {
          adjust_trend = "↑";
        }

        // 幅度格式一：“0.11元/升-0.14元/升” → “0.11-0.14元/L”
        // 幅度格式二：“130元/吨”，没有每升区间时退而使用
        const adjust_value_re = /([\d\.]+)元\/升-([\d\.]+)元\/升/;
        const adjust_value_re2 = /[\d\.]+元\/吨/;
        const adjust_value_match = adjust_value.match(adjust_value_re);

        if (adjust_trend === "—") {
          // 搁浅时不展示幅度，避免误导
          adjust_value = "预计搁浅";
        } else if (adjust_value_match && adjust_value_match.length === 3) {
          adjust_value = `${adjust_value_match[1]}-${adjust_value_match[2]}元/L`;
        } else {
          const adjust_value_match2 = adjust_value.match(adjust_value_re2);

          if (adjust_value_match2) {
            adjust_value = adjust_value_match2[0];
          }
        }
      }

      const friendly_tips = `下次${adjust_date}调整 ${adjust_trend} ${adjust_value}`;

      // 数量不对通常是地区填错（页面不存在）或网站改版
      if (prices.length !== 4) {
        console.log(`解析油价信息失败, 数量=${prices.length}, URL=${query_addr}`);
        $notification.post("油价查询", "解析失败", "请检查脚本或反馈给开发者");
        $done({});
      } else {
        const content = `${prices[0].name}  ${prices[0].value}\n${prices[1].name}  ${prices[1].value}\n${prices[2].name}  ${prices[2].value}\n${prices[3].name}  ${prices[3].value}`;
        
        $notification.post("实时油价信息", friendly_tips, content);
        console.log(`油价查询成功：\n${content}\n${friendly_tips}`);
        $done({});
      }
    }
  }
);