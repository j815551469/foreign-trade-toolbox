const TRADE_DATA = {
  colorDict: [
    { id: "c-red", zh: "红色", en: "Red" },
    { id: "c-orange", zh: "橙色", en: "Orange" },
    { id: "c-yellow", zh: "黄色", en: "Yellow" },
    { id: "c-green", zh: "绿色", en: "Green" },
    { id: "c-darkgreen", zh: "墨绿", en: "Dark Green" },
    { id: "c-olive", zh: "军绿", en: "Olive" },
    { id: "c-cyan", zh: "青色", en: "Cyan" },
    { id: "c-blue", zh: "蓝色", en: "Blue" },
    { id: "c-skyblue", zh: "天蓝", en: "Sky Blue" },
    { id: "c-navy", zh: "藏青", en: "Navy" },
    { id: "c-purple", zh: "紫色", en: "Purple" },
    { id: "c-pink", zh: "粉色", en: "Pink" },
    { id: "c-rose", zh: "玫红", en: "Rose" },
    { id: "c-maroon", zh: "酒红", en: "Maroon" },
    { id: "c-white", zh: "白色", en: "White" },
    { id: "c-black", zh: "黑色", en: "Black" },
    { id: "c-grey", zh: "灰色", en: "Grey" },
    { id: "c-silver", zh: "银色", en: "Silver" },
    { id: "c-gold", zh: "金色", en: "Gold" },
    { id: "c-brown", zh: "棕色", en: "Brown" },
    { id: "c-beige", zh: "米白", en: "Beige" },
    { id: "c-khaki", zh: "卡其", en: "Khaki" },
    { id: "c-coffee", zh: "咖啡", en: "Coffee" },
    { id: "c-champagne", zh: "香槟", en: "Champagne" },
    { id: "c-linen", zh: "亚麻", en: "Linen" },
    { id: "c-camo", zh: "迷彩", en: "Camo" },
    { id: "c-gradient", zh: "渐变", en: "Gradient" },
    { id: "c-rainbow", zh: "七彩", en: "Rainbow" }
  ],

  currencies: [
    { code: "USD", name: "美元", rate: 1 },
    { code: "CNY", name: "人民币", rate: 7.2 },
    { code: "EUR", name: "欧元", rate: 0.92 },
    { code: "GBP", name: "英镑", rate: 0.79 },
    { code: "JPY", name: "日元", rate: 149 },
    { code: "INR", name: "印度卢比", rate: 83.5 },
    { code: "AUD", name: "澳元", rate: 1.52 },
    { code: "CAD", name: "加元", rate: 1.36 },
    { code: "SGD", name: "新加坡元", rate: 1.34 },
    { code: "AED", name: "阿联酋迪拉姆", rate: 3.67 },
    { code: "BRL", name: "巴西雷亚尔", rate: 5.3 },
    { code: "MXN", name: "墨西哥比索", rate: 17.8 },
    { code: "RUB", name: "俄罗斯卢布", rate: 91 },
    { code: "KRW", name: "韩元", rate: 1350 },
    { code: "VND", name: "越南盾", rate: 25400 },
    { code: "THB", name: "泰铢", rate: 36.2 },
    { code: "MYR", name: "马来西亚林吉特", rate: 4.7 },
    { code: "IDR", name: "印尼盾", rate: 16000 },
    { code: "PHP", name: "菲律宾比索", rate: 56.5 },
    { code: "TRY", name: "土耳其里拉", rate: 32.8 },
    { code: "ZAR", name: "南非兰特", rate: 18.5 }
  ],

  products: [
    { id: "p1", model: "LS-5M", name: "LED 灯条 5m", nameEn: "LED Light Strip 5m", category: "电子照明", hsCode: "9405.42", unitCost: 12, moq: 1000, cartonL: 60, cartonW: 40, cartonH: 35, cartonWeight: 18, qtyPerCarton: 100, supplier: "深圳光宇电子", notes: "CE/RoHS，适合家居照明" },
    { id: "p2", model: "SP-01", name: "智能插座", nameEn: "Smart Wi-Fi Plug", category: "电子电气", hsCode: "8536.50", unitCost: 18, moq: 500, cartonL: 50, cartonW: 40, cartonH: 30, cartonWeight: 15, qtyPerCarton: 200, supplier: "东莞智能电气", notes: "WiFi 版，需 UL 认证" },
    { id: "p3", model: "WB-600", name: "不锈钢保温杯 600ml", nameEn: "Stainless Steel Mug 600ml", category: "餐厨用品", hsCode: "7323.93", unitCost: 8.5, moq: 2000, cartonL: 55, cartonW: 40, cartonH: 35, cartonWeight: 16, qtyPerCarton: 120, supplier: "永康杯业", notes: "LFGB/FDA 认证" },
    { id: "p4", model: "TS-001", name: "棉质 T 恤", nameEn: "Cotton T-Shirt", category: "服装纺织", hsCode: "6109.10", unitCost: 14, moq: 1000, cartonL: 50, cartonW: 35, cartonH: 30, cartonWeight: 15, qtyPerCarton: 200, supplier: "广州制衣厂", notes: "可按码数混装" },
    { id: "p5", model: "FD-120", name: "折叠书桌", nameEn: "Folding Desk", category: "家具", hsCode: "9403.60", unitCost: 85, moq: 200, cartonL: 110, cartonW: 60, cartonH: 12, cartonWeight: 20, qtyPerCarton: 20, supplier: "佛山家具厂", notes: "大件货，注意泡货计费" },
    { id: "p6", model: "CM-350", name: "陶瓷马克杯 350ml", nameEn: "Ceramic Mug 350ml", category: "餐厨用品", hsCode: "6912.00", unitCost: 4.2, moq: 3000, cartonL: 45, cartonW: 35, cartonH: 30, cartonWeight: 14, qtyPerCarton: 100, supplier: "潮州陶瓷厂", notes: "易碎品，需泡沫隔板" },
    { id: "p7", model: "PF-01", name: "自动宠物喂食器", nameEn: "Automatic Pet Feeder", category: "宠物用品", hsCode: "3924.90", unitCost: 22, moq: 1000, cartonL: 60, cartonW: 45, cartonH: 40, cartonWeight: 17, qtyPerCarton: 60, supplier: "宁波宠物用品", notes: "北美市场需 FCC/UL" },
    { id: "p8", model: "PB-10K", name: "移动电源 10000mAh", nameEn: "Power Bank 10000mAh", category: "电子电气", hsCode: "8507.60", unitCost: 28, moq: 500, cartonL: 45, cartonW: 30, cartonH: 25, cartonWeight: 12, qtyPerCarton: 80, supplier: "惠州电池厂", notes: "UN38.3 报告 + 危包证" }
  ],

  orders: [
    { id: "o1", poNo: "PO-20260802", clientId: "c2", clientName: "Nordhaus GmbH", product: "智能插座 SP-01", qty: 2000, amount: 12400, currency: "EUR", status: "生产中", incoterm: "CIF", payment: "30% T/T + 70% 见提单", orderDate: "2026-08-02", deliveryDate: "2026-09-10", port: "宁波 → 汉堡", tracking: "", notes: "需要 CE/RoHS 证书" },
    { id: "o2", poNo: "PO-20260805", clientId: "c1", clientName: "Brightpath Imports", product: "LED 灯条 5m", qty: 5000, amount: 19250, currency: "USD", status: "已接单", incoterm: "FOB", payment: "30% 定金 + 70% 发货前", orderDate: "2026-08-05", deliveryDate: "2026-08-28", port: "深圳 → 洛杉矶", tracking: "", notes: "客户指定验货行 SGS" },
    { id: "o3", poNo: "PO-20260804", clientId: "c3", clientName: "Gulf Trade Co.", product: "自动宠物喂食器", qty: 1200, amount: 26400, currency: "USD", status: "样品确认中", incoterm: "EXW", payment: "T/T", orderDate: "2026-08-04", deliveryDate: "2026-09-05", port: "宁波 → 杰贝阿里", tracking: "", notes: "样品已寄，等待确认" }
  ],

  hsCodes: [
    { code: "9405.42.90", code6: "9405.42", name: "其他电灯及照明装置（LED灯条、灯具等）", category: "电子照明", keywords: "LED 灯条 灯具 照明", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "多数国家需 CE/UL/FCC 认证；LED灯条常见归类，申报前请复核", source: "海关税则参考" },
    { code: "8507.60.00", code6: "8507.60", name: "锂离子蓄电池", category: "电子电气", keywords: "锂电池 充电宝 电池", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "空运受限，需 UN38.3 与危包证", source: "海关税则参考" },
    { code: "8536.69.00", code6: "8536.69", name: "其他插头及插座", category: "电子电气", keywords: "插头 插座 智能插座 接线装置", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "智能插座常见归入本编码；如按开关申报可为 8536.50.00，以海关归类为准", source: "海关税则参考" },
    { code: "8536.50.00", code6: "8536.50", name: "其他开关（电压不超过1000V）", category: "电子电气", keywords: "开关 控制器 智能家居", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "部分市场需强制认证", source: "海关税则参考" },
    { code: "3924.90.00", code6: "3924.90", name: "其他塑料制餐具及厨房用具", category: "塑料家居", keywords: "塑料制品 宠物用品 收纳", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "食品接触类商品注意相关测试", source: "海关税则参考" },
    { code: "6912.00.00", code6: "6912.00", name: "陶瓷制餐具及厨房器具", category: "陶瓷餐具", keywords: "马克杯 陶瓷餐具 杯子", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "欧美需铅镉迁移测试", source: "海关税则参考" },
    { code: "7323.93.00", code6: "7323.93", name: "不锈钢制餐桌、厨房或其他家用器具", category: "不锈钢餐厨", keywords: "不锈钢水壶 保温杯 餐具", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "LFGB/FDA 等食品级认证", source: "海关税则参考" },
    { code: "6109.10.00", code6: "6109.10", name: "棉制针织或钩编T恤衫、汗衫及其他背心", category: "服装纺织", keywords: "T恤 棉质 服装", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "注意成分标签与关税配额", source: "海关税则参考" },
    { code: "9403.60.99", code6: "9403.60", name: "其他木家具", category: "家具", keywords: "折叠书桌 木家具 书桌", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "折叠书桌按实际材质归类，木制常见归入本编码", source: "海关税则参考" },
    { code: "9403.20.00", code6: "9403.20", name: "其他金属家具", category: "家具", keywords: "金属家具 铁架桌 办公桌", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "金属材质书桌/架常见归类", source: "海关税则参考" },
    { code: "9503.00.00", code6: "9503.00", name: "玩具（玩偶、缩小模型、智力玩具等）", category: "玩具", keywords: "玩具 儿童 模型", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "EN71/ASTM F963 等安全标准", source: "海关税则参考" },
    { code: "4202.12.90", code6: "4202.12", name: "以塑料或纺织材料作面的箱、包", category: "箱包", keywords: "背包 旅行包 箱包", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "面料与配件需提供成分", source: "海关税则参考" },
    { code: "8517.13.00", code6: "8517.13", name: "智能手机", category: "通讯设备", keywords: "手机 通讯 智能设备", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "射频认证复杂，建议专业清关", source: "海关税则参考" },
    { code: "8471.30.00", code6: "8471.30", name: "便携式自动数据处理设备", category: "电脑设备", keywords: "平板 笔记本 电脑", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "部分国家需能效与 EMC 认证", source: "海关税则参考" },
    { code: "8205.59.00", code6: "8205.59", name: "其他手工工具", category: "五金工具", keywords: "工具 五金 手动工具", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "注意材质与防锈处理", source: "海关税则参考" },
    { code: "8504.40.90", code6: "8504.40", name: "其他静止式变流器", category: "电子电气", keywords: "电源适配器 充电器 变流器", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "电源类产品注意认证与能效要求", source: "海关税则参考" },
    { code: "8544.42.00", code6: "8544.42", name: "装有插头或插座的电缆", category: "电子电气", keywords: "数据线 充电线 电缆", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "常见 USB 线/电源线归类", source: "海关税则参考" },
    { code: "8518.30.00", code6: "8518.30", name: "耳机及耳塞", category: "电子电气", keywords: "耳机 耳塞 蓝牙耳机", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "蓝牙耳机需无线电型号核准", source: "海关税则参考" },
    { code: "4015.19.00", code6: "4015.19", name: "其他硫化橡胶制手套", category: "劳保用品", keywords: "橡胶手套 劳保手套", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "一次性/医用需按实际用途确认", source: "海关税则参考" },
    { code: "4203.21.00", code6: "4203.21", name: "皮革或再生皮革制手套", category: "服装纺织", keywords: "皮手套 皮革手套", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "注意原产地与材质申报", source: "海关税则参考" },
    { code: "6505.00.00", code6: "6505.00", name: "针织或钩编帽类", category: "服装纺织", keywords: "帽子 针织帽 棒球帽", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "棒球帽等按材质归类", source: "海关税则参考" },
    { code: "7013.49.00", code6: "7013.49", name: "其他玻璃器皿", category: "玻璃制品", keywords: "玻璃杯 玻璃餐具 玻璃器皿", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "注意易碎包装与铅镉测试", source: "海关税则参考" },
    { code: "9607.11.00", code6: "9607.11", name: "装有贱金属齿的拉链", category: "五金辅料", keywords: "拉链 服装辅料 金属拉链", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "服装辅料常见归类", source: "海关税则参考" },
    { code: "3926.90.90", code6: "3926.90", name: "其他塑料制品", category: "塑料制品", keywords: "塑料件 塑料制品 注塑件", rebate: "13%", supervision: "以海关监管条件为准", inspection: "以海关检验检疫类别为准", notes: "未列名塑料制品常见兜底编码", source: "海关税则参考" }
  ],

  glossary: [
    { en: "Inquiry", zh: "询盘", category: "开发客户", example: "We received your inquiry from Alibaba." },
    { en: "Quotation / Quote", zh: "报价", category: "报价谈判", example: "Please find our quotation attached." },
    { en: "Proforma Invoice (PI)", zh: "形式发票", category: "单证", example: "We will issue a PI once the price is confirmed." },
    { en: "Commercial Invoice", zh: "商业发票", category: "单证", example: "The commercial invoice must match the customs value." },
    { en: "Packing List", zh: "装箱单", category: "单证", example: "Please send the packing list with the shipping documents." },
    { en: "Bill of Lading (B/L)", zh: "提单", category: "物流", example: "The original B/L is required for customs clearance." },
    { en: "Air Waybill (AWB)", zh: "空运单", category: "物流", example: "The AWB number is needed for tracking." },
    { en: "FOB (Free On Board)", zh: "船上交货", category: "贸易术语", example: "Our price is FOB Ningbo." },
    { en: "CIF (Cost, Insurance & Freight)", zh: "成本加保险费运费", category: "贸易术语", example: "CIF Hamburg includes ocean freight and insurance." },
    { en: "EXW (Ex Works)", zh: "工厂交货", category: "贸易术语", example: "EXW price means the buyer arranges pickup." },
    { en: "MOQ (Minimum Order Quantity)", zh: "最小起订量", category: "报价谈判", example: "Our MOQ is 1,000 pieces." },
    { en: "Lead Time", zh: "交期 / 生产周期", category: "生产交付", example: "The lead time is 25 days after deposit." },
    { en: "Delivery Time", zh: "交货时间", category: "生产交付", example: "Delivery time is 30 days after confirmation." },
    { en: "Deposit", zh: "定金", category: "付款", example: "A 30% deposit is required to start production." },
    { en: "Balance Payment", zh: "尾款", category: "付款", example: "The balance is payable before shipment." },
    { en: "T/T (Telegraphic Transfer)", zh: "电汇", category: "付款", example: "We usually accept T/T or L/C at sight." },
    { en: "L/C (Letter of Credit)", zh: "信用证", category: "付款", example: "Please open the L/C through a confirmed bank." },
    { en: "D/P (Documents against Payment)", zh: "付款交单", category: "付款", example: "D/P terms require payment before documents are released." },
    { en: "D/A (Documents against Acceptance)", zh: "承兑交单", category: "付款", example: "D/A carries higher payment risk." },
    { en: "Consignee", zh: "收货人", category: "物流单证", example: "Please confirm the consignee details." },
    { en: "Notify Party", zh: "通知方", category: "物流单证", example: "The notify party is usually the buyer." },
    { en: "Shipping Marks", zh: "唛头", category: "物流单证", example: "Shipping marks must be printed on each carton." },
    { en: "Carton", zh: "纸箱", category: "包装", example: "Each carton contains 100 pieces." },
    { en: "Gross Weight", zh: "毛重", category: "包装物流", example: "Gross weight includes the carton." },
    { en: "Net Weight", zh: "净重", category: "包装物流", example: "Net weight excludes packaging." },
    { en: "CBM (Cubic Meter)", zh: "立方米 / 方", category: "物流", example: "Total volume is 12.5 CBM." },
    { en: "Volumetric Weight", zh: "体积重", category: "物流", example: "Air freight is charged by volumetric weight." },
    { en: "Freight Forwarder", zh: "货代", category: "物流", example: "Our forwarder will arrange the container." },
    { en: "Customs Clearance", zh: "清关", category: "海关合规", example: "Buyer is responsible for import customs clearance." },
    { en: "Duty / Tariff", zh: "关税", category: "海关合规", example: "The import duty is paid by the buyer." },
    { en: "Certificate of Origin (CO)", zh: "原产地证", category: "单证", example: "A CO is required for tariff preference." },
    { en: "Inspection Certificate", zh: "检验证书", category: "单证", example: "The inspection certificate will be issued by SGS." },
    { en: "Warranty", zh: "保修", category: "售后", example: "We provide a 12-month warranty." },
    { en: "After-sales Service", zh: "售后服务", category: "售后", example: "Our after-sales team will handle the issue." },
    { en: "Replacement", zh: "换货", category: "售后", example: "We will send replacements for defective units." },
    { en: "Force Majeure", zh: "不可抗力", category: "合同", example: "Force majeure delays will be notified in writing." },
    { en: "Arbitration", zh: "仲裁", category: "合同", example: "Disputes shall be settled by arbitration." },
    { en: "Sample", zh: "样品", category: "开发客户", example: "We can send samples by DHL." },
    { en: "Bulk Order", zh: "大货订单", category: "订单", example: "This price applies to bulk orders only." },
    { en: "Reorder", zh: "返单", category: "订单", example: "We look forward to your reorder." },
    { en: "Backorder", zh: "缺货订单 / 延交订单", category: "订单", example: "The remaining quantity will ship as backorder." }
  ],

  countryExtras: {
    "美国": { workWeek: "周一至周五", platforms: "Amazon、Walmart、Wayfair、Home Depot", certification: "UL / FCC / FDA（按品类）", marketNote: "重视认证、交期与售后，价格接受度较高" },
    "英国": { workWeek: "周一至周五", platforms: "Amazon UK、eBay、Argos", certification: "UKCA / CE", marketNote: "脱欧后需关注 UKCA 与欧盟 CE 区别" },
    "德国": { workWeek: "周一至周五", platforms: "Amazon DE、Otto、Zalando", certification: "CE / GS / WEEE", marketNote: "技术文件要求严格，重视参数真实性" },
    "法国": { workWeek: "周一至周五", platforms: "Cdiscount、Fnac、Amazon FR", certification: "CE / ERP", marketNote: "夏季假期集中，提前排产" },
    "意大利": { workWeek: "周一至周五", platforms: "Amazon IT、eBay", certification: "CE / IMQ", marketNote: "中小买家多，重视样品与关系" },
    "西班牙": { workWeek: "周一至周五", platforms: "Amazon ES、El Corte Inglés", certification: "CE / AENOR", marketNote: "午休文化明显，回复节奏较慢" },
    "荷兰": { workWeek: "周一至周五", platforms: "Bol.com、Amazon NL、Coolblue", certification: "CE / WEEE", marketNote: "英语普及率高，沟通高效" },
    "俄罗斯": { workWeek: "周一至周五", platforms: "Ozon、Wildberries、Yandex Market", certification: "EAC / GOST", marketNote: "清关与认证复杂，需提前确认 HS 编码" },
    "阿联酋": { workWeek: "周一至周五（周六日休）", platforms: "亚马逊阿联酋、Noon", certification: "ECAS / SFDA（按品类）", marketNote: "周五下午至周六为休息，尊重宗教习惯" },
    "沙特阿拉伯": { workWeek: "周日至周四", platforms: "Amazon SA、Noon", certification: "SASO / SFDA", marketNote: "工作日为周日至周四，注意斋月节奏" },
    "印度": { workWeek: "周一至周六（部分）", platforms: "Amazon IN、Flipkart、Meesho", certification: "BIS / BEE（按品类）", marketNote: "价格敏感，谈判周期长" },
    "日本": { workWeek: "周一至周五", platforms: "亚马逊日本、乐天、Yahoo", certification: "PSE / TELEC / JIS", marketNote: "重视品质、细节与长期关系" },
    "韩国": { workWeek: "周一至周五", platforms: "Coupang、Naver、Gmarket", certification: "KC / KCC", marketNote: "决策快，重视样品与速度" },
    "新加坡": { workWeek: "周一至周五", platforms: "Shopee、Lazada、Amazon SG", certification: "IMDA / SAFETY MARK", marketNote: "商业规则成熟，英语沟通方便" },
    "马来西亚": { workWeek: "周一至周五", platforms: "Shopee、Lazada", certification: "SIRIM（按品类）", marketNote: "多民族市场，注意开斋节与春节" },
    "泰国": { workWeek: "周一至周五", platforms: "Shopee、Lazada", certification: "TISI / NBTC（按品类）", marketNote: "重视礼节，价格谈判常见" },
    "越南": { workWeek: "周一至周六（部分）", platforms: "Shopee、Tiki、Lazada", certification: "CR Mark（按品类）", marketNote: "市场增长快，重视成本与交期" },
    "印度尼西亚": { workWeek: "周一至周五", platforms: "Shopee、Tokopedia、Lazada", certification: "SNI / Postel", marketNote: "宗教节日多，提前确认假期影响" },
    "菲律宾": { workWeek: "周一至周五", platforms: "Shopee、Lazada", certification: "BPS / NTC", marketNote: "英语普及高，圣诞季长" },
    "巴西": { workWeek: "周一至周五", platforms: "Mercado Livre、Amazon BR、Shopee", certification: "ANATEL / INMETRO", marketNote: "清关复杂，税费高，重视本地认证" },
    "墨西哥": { workWeek: "周一至周五", platforms: "Mercado Libre、Amazon MX", certification: "NOM（按品类）", marketNote: "重视关系与信任" },
    "澳大利亚": { workWeek: "周一至周五", platforms: "Amazon AU、eBay", certification: "RCM / SAA", marketNote: "邮件直接友好，重视品质证明" },
    "加拿大": { workWeek: "周一至周五", platforms: "Amazon CA、Walmart CA", certification: "CSA / IC / Health Canada", marketNote: "市场规范，重视合规与认证" },
    "土耳其": { workWeek: "周一至周五", platforms: "Trendyol、Hepsiburada", certification: "CE / TSE", marketNote: "谈判能力强，重视关系" },
    "南非": { workWeek: "周一至周五", platforms: "Takealot、Amazon ZA", certification: "SABS / NRCS", marketNote: "重视价格与服务，注意电力与物流影响" }
  },

  unitCategories: {
    length: {
      label: "长度",
      units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mile: 1609.344 }
    },
    weight: {
      label: "重量",
      units: { mg: 0.000001, g: 0.001, kg: 1, t: 1000, oz: 0.028349523, lb: 0.45359237 }
    },
    volume: {
      label: "体积",
      units: { ml: 0.001, L: 1, m3: 1000, ft3: 28.3168466, gal: 3.78541178, in3: 0.016387064 }
    },
    area: {
      label: "面积",
      units: { cm2: 0.0001, m2: 1, ft2: 0.09290304, in2: 0.00064516, acre: 4046.8564224 }
    },
    temperature: {
      label: "温度",
      units: { C: "C", F: "F", K: "K" }
    }
  },

  containers: [
    { code: "20GP", inner: "5.89 x 2.35 x 2.39 m", volume: 33.1, usable: 28, payload: 21.8, note: "适合轻抛货或小批量整柜" },
    { code: "40GP", inner: "12.03 x 2.35 x 2.39 m", volume: 67.5, usable: 58, payload: 26.6, note: "常用干货柜" },
    { code: "40HQ", inner: "12.03 x 2.35 x 2.69 m", volume: 76.3, usable: 68, payload: 26.5, note: "体积敏感产品首选" }
  ],

  logisticsRates: [
    { id: "us_west", name: "中国 → 美国西岸", lcl: 28, fcl20: 2200, fcl40: 3900, air: 6.5, express: 9.5 },
    { id: "us_east", name: "中国 → 美国东岸", lcl: 36, fcl20: 3000, fcl40: 5200, air: 7.2, express: 10.5 },
    { id: "eu", name: "中国 → 欧洲（汉堡/鹿特丹）", lcl: 22, fcl20: 1800, fcl40: 3200, air: 5.2, express: 7.8 },
    { id: "sea", name: "中国 → 东南亚", lcl: 14, fcl20: 1100, fcl40: 1900, air: 3.2, express: 5.8 },
    { id: "me", name: "中国 → 中东（迪拜）", lcl: 20, fcl20: 1600, fcl40: 2800, air: 4.4, express: 8.2 },
    { id: "sa", name: "中国 → 南美（桑托斯）", lcl: 45, fcl20: 3600, fcl40: 6200, air: 8.5, express: 12.5 }
  ],

  incoterms: [
    { code: "EXW", group: "E", name: "工厂交货", desc: "买方负责提货及后续所有费用和风险", transport: "任意", risk: "工厂/仓库", tips: "报价简单，但海外买家接受度较低" },
    { code: "FCA", group: "F", name: "货交承运人", desc: "卖方交货给买方指定承运人后风险转移", transport: "任意", risk: "指定承运人", tips: "适合集装箱、快递和空运" },
    { code: "FAS", group: "F", name: "船边交货", desc: "卖方将货交到船边，装船费与风险由买方承担", transport: "海运", risk: "船边", tips: "散杂货和液体货常见" },
    { code: "FOB", group: "F", name: "船上交货", desc: "卖方负责装船，货越过船舷后风险转移", transport: "海运", risk: "装运港船上", tips: "外贸最常用，需同步确认起运港" },
    { code: "CFR", group: "C", name: "成本加运费", desc: "卖方承担运费，但风险在装船时转移", transport: "海运", risk: "装运港船上", tips: "适合愿意自行投保的客户" },
    { code: "CIF", group: "C", name: "成本、保险费加运费", desc: "卖方承担运费和保险费", transport: "海运", risk: "装运港船上", tips: "保险一般为最低险别，需明确保额" },
    { code: "CPT", group: "C", name: "运费付至", desc: "卖方支付至指定目的地运费", transport: "任意", risk: "交承运人", tips: "多式联运常用" },
    { code: "CIP", group: "C", name: "运费和保险费付至", desc: "卖方支付运费并购买运输保险", transport: "任意", risk: "交承运人", tips: "2020 版要求更高保险级别" },
    { code: "DAP", group: "D", name: "目的地交货", desc: "卖方将货运至指定目的地，不负责卸货", transport: "任意", risk: "目的地", tips: "跨境电商和 DDP 变体常用" },
    { code: "DPU", group: "D", name: "卸货地交货", desc: "卖方负责运至目的地并卸货", transport: "任意", risk: "卸货地", tips: "2020 版由 DAT 更名而来" },
    { code: "DDP", group: "D", name: "完税后交货", desc: "卖方承担运输、清关、关税直至送货上门", transport: "任意", risk: "目的地", tips: "卖方责任最大，报价需包含税费" }
  ],

  paymentTerms: [
    { code: "T/T", name: "电汇", en: "30% T/T deposit, 70% balance before shipment", risk: "低", desc: "30% 定金 + 70% 发货前，最常见" },
    { code: "T/T", name: "电汇", en: "30% T/T deposit, 70% against B/L copy", risk: "低", desc: "30% 定金 + 70% 见提单副本付款，兼顾双方" },
    { code: "T/T", name: "电汇", en: "100% T/T before shipment", risk: "低", desc: "发货前全额电汇，适合小单/首单" },
    { code: "T/T", name: "电汇", en: "T/T after shipment", risk: "中", desc: "发货后电汇，需先评估客户信用" },
    { code: "L/C", name: "信用证", en: "L/C at sight", risk: "中", desc: "即期信用证，银行信用，适合大额订单" },
    { code: "L/C", name: "信用证", en: "L/C 60 days after sight", risk: "中", desc: "远期信用证，注意软条款与单据一致性" },
    { code: "D/P", name: "付款交单", en: "D/P at sight", risk: "中高", desc: "买方付款后才能取得单据，银行不承担付款责任" },
    { code: "D/A", name: "承兑交单", en: "D/A 30 days", risk: "高", desc: "买方承兑后即可取单，收款风险较高" },
    { code: "O/A", name: "赊销", en: "O/A 30/60 days (open account)", risk: "高", desc: "先发货后付款，只建议老客户并配合信用保险" },
    { code: "Other", name: "其他", en: "PayPal / Western Union (samples, small orders)", risk: "中", desc: "样品或小额订单常用" }
  ],

  countries: [
    { name: "美国", code: "US", currency: "USD 美元", timezone: "America/New_York", phone: "+1", language: "英语", holidays: "独立日、感恩节、圣诞节", payment: "T/T、L/C、PayPal", tips: "邮件直接简洁；重视准时与售后；报价常用 FOB/CIF" },
    { name: "英国", code: "GB", currency: "GBP 英镑", timezone: "Europe/London", phone: "+44", language: "英语", holidays: "复活节、圣诞、银行假日", payment: "T/T、L/C、O/A", tips: "重契约与礼貌；邮件用正式开头，避免过度热情" },
    { name: "德国", code: "DE", currency: "EUR 欧元", timezone: "Europe/Berlin", phone: "+49", language: "德语、英语", holidays: "复活节、国庆日、圣诞", payment: "L/C、T/T", tips: "重视技术细节、认证和准确参数；报价结构要清晰" },
    { name: "法国", code: "FR", currency: "EUR 欧元", timezone: "Europe/Paris", phone: "+33", language: "法语、英语", holidays: "劳动节、国庆日、圣诞", payment: "T/T、L/C", tips: "夏季假期较长；商务往来较正式" },
    { name: "意大利", code: "IT", currency: "EUR 欧元", timezone: "Europe/Rome", phone: "+39", language: "意大利语、英语", holidays: "复活节、八月节、圣诞", payment: "T/T、L/C", tips: "中小企业多，决策链较短；重视样品" },
    { name: "西班牙", code: "ES", currency: "EUR 欧元", timezone: "Europe/Madrid", phone: "+34", language: "西班牙语、英语", holidays: "圣周、国庆、圣诞", payment: "T/T、L/C", tips: "午休文化明显；沟通可稍热情" },
    { name: "荷兰", code: "NL", currency: "EUR 欧元", timezone: "Europe/Amsterdam", phone: "+31", language: "荷兰语、英语", holidays: "国王日、圣诞", payment: "T/T、L/C", tips: "英语普及率高；对效率与价格敏感" },
    { name: "俄罗斯", code: "RU", currency: "RUB 卢布", timezone: "Europe/Moscow", phone: "+7", language: "俄语", holidays: "胜利日、新年", payment: "T/T、L/C", tips: "清关复杂，需确认认证与 HS 编码；沟通直接" },
    { name: "阿联酋", code: "AE", currency: "AED 迪拉姆", timezone: "Asia/Dubai", phone: "+971", language: "阿拉伯语、英语", holidays: "开斋节、宰牲节、国庆", payment: "T/T、L/C", tips: "周五下午到周六是休息；重视信誉与关系" },
    { name: "沙特阿拉伯", code: "SA", currency: "SAR 沙特里亚尔", timezone: "Asia/Riyadh", phone: "+966", language: "阿拉伯语、英语", holidays: "开斋节、宰牲节、国庆", payment: "L/C、T/T", tips: "需尊重宗教习惯；工作日为周日至周四" },
    { name: "印度", code: "IN", currency: "INR 印度卢比", timezone: "Asia/Kolkata", phone: "+91", language: "印地语、英语", holidays: "排灯节、独立日", payment: "T/T、L/C", tips: "价格极敏感，重视价格谈判；英语口音需耐心" },
    { name: "日本", code: "JP", currency: "JPY 日元", timezone: "Asia/Tokyo", phone: "+81", language: "日语", holidays: "黄金周、盂兰盆节、新年", payment: "T/T、L/C", tips: "重视细节、品质与长期关系；回复要严谨" },
    { name: "韩国", code: "KR", currency: "KRW 韩元", timezone: "Asia/Seoul", phone: "+82", language: "韩语", holidays: "春节、中秋、国庆", payment: "T/T、L/C", tips: "决策快，重视速度和样品；邮件可较直接" },
    { name: "新加坡", code: "SG", currency: "SGD 新加坡元", timezone: "Asia/Singapore", phone: "+65", language: "英语、华语", holidays: "春节、开斋节、国庆", payment: "T/T、L/C、O/A", tips: "商务规则成熟，英语沟通方便" },
    { name: "马来西亚", code: "MY", currency: "MYR 林吉特", timezone: "Asia/Kuala_Lumpur", phone: "+60", language: "马来语、英语", holidays: "开斋节、春节、国庆", payment: "T/T、L/C", tips: "多民族市场，注意节庆时间" },
    { name: "泰国", code: "TH", currency: "THB 泰铢", timezone: "Asia/Bangkok", phone: "+66", language: "泰语、英语", holidays: "宋干节、国王日", payment: "T/T、L/C", tips: "重视礼节与微笑文化；价格谈判常见" },
    { name: "越南", code: "VN", currency: "VND 越南盾", timezone: "Asia/Ho_Chi_Minh", phone: "+84", language: "越南语、英语", holidays: "春节、国庆", payment: "T/T、L/C", tips: "市场增长快，重视交期与成本" },
    { name: "印度尼西亚", code: "ID", currency: "IDR 印尼盾", timezone: "Asia/Jakarta", phone: "+62", language: "印尼语、英语", holidays: "开斋节、独立日", payment: "T/T、L/C", tips: "宗教节日多，提前确认假期影响" },
    { name: "菲律宾", code: "PH", currency: "PHP 比索", timezone: "Asia/Manila", phone: "+63", language: "英语、菲律宾语", holidays: "圣周、圣诞季", payment: "T/T、L/C", tips: "英语普及高，圣诞季长" },
    { name: "巴西", code: "BR", currency: "BRL 雷亚尔", timezone: "America/Sao_Paulo", phone: "+55", language: "葡萄牙语、英语", holidays: "狂欢节、独立日", payment: "T/T、L/C", tips: "清关复杂，重视认证；沟通热情" },
    { name: "墨西哥", code: "MX", currency: "MXN 比索", timezone: "America/Mexico_City", phone: "+52", language: "西班牙语、英语", holidays: "亡灵节、独立日", payment: "T/T、L/C", tips: "重视关系与信任，邮件可先寒暄" },
    { name: "澳大利亚", code: "AU", currency: "AUD 澳元", timezone: "Australia/Sydney", phone: "+61", language: "英语", holidays: "国庆日、圣诞", payment: "T/T、L/C、O/A", tips: "邮件直接友好，重视品质证明" },
    { name: "加拿大", code: "CA", currency: "CAD 加元", timezone: "America/Toronto", phone: "+1", language: "英语、法语", holidays: "国庆日、感恩节、圣诞", payment: "T/T、L/C", tips: "市场规范，重视合规与认证" },
    { name: "土耳其", code: "TR", currency: "TRY 里拉", timezone: "Europe/Istanbul", phone: "+90", language: "土耳其语、英语", holidays: "开斋节、宰牲节、国庆", payment: "T/T、L/C", tips: "谈判能力强，重视关系" },
    { name: "南非", code: "ZA", currency: "ZAR 兰特", timezone: "Africa/Johannesburg", phone: "+27", language: "英语、南非荷兰语", holidays: "人权日、自由日", payment: "T/T、L/C", tips: "重视价格与服务；注意电力与物流影响" }
  ],

  timezones: [
    { city: "北京", tz: "Asia/Shanghai" },
    { city: "香港", tz: "Asia/Hong_Kong" },
    { city: "新加坡", tz: "Asia/Singapore" },
    { city: "东京", tz: "Asia/Tokyo" },
    { city: "首尔", tz: "Asia/Seoul" },
    { city: "曼谷", tz: "Asia/Bangkok" },
    { city: "雅加达", tz: "Asia/Jakarta" },
    { city: "迪拜", tz: "Asia/Dubai" },
    { city: "伊斯坦布尔", tz: "Europe/Istanbul" },
    { city: "莫斯科", tz: "Europe/Moscow" },
    { city: "柏林", tz: "Europe/Berlin" },
    { city: "巴黎", tz: "Europe/Paris" },
    { city: "伦敦", tz: "Europe/London" },
    { city: "纽约", tz: "America/New_York" },
    { city: "芝加哥", tz: "America/Chicago" },
    { city: "洛杉矶", tz: "America/Los_Angeles" },
    { city: "墨西哥城", tz: "America/Mexico_City" },
    { city: "圣保罗", tz: "America/Sao_Paulo" },
    { city: "悉尼", tz: "Australia/Sydney" },
    { city: "约翰内斯堡", tz: "Africa/Johannesburg" }
  ],

  emailCategories: [
    { id: "new", name: "开发新客户" },
    { id: "reply", name: "询盘回复" },
    { id: "quote", name: "报价跟进" },
    { id: "payment", name: "催款提醒" },
    { id: "ship", name: "发货通知" },
    { id: "arrival", name: "到货跟进" },
    { id: "after", name: "售后处理" },
    { id: "season", name: "节日问候" },
    { id: "sample", name: "样品与认证" },
    { id: "order", name: "订单确认" },
    { id: "delay", name: "交期与异常" },
    { id: "invoice", name: "发票与财务" },
    { id: "fair", name: "展会与营销" }
  ],

  emailTemplates: [
    {
      category: "new",
      title: "首次开发信",
      subject: "Introduction from {{Company}} — {{Product}} manufacturer",
      body: "Dear {{Customer Name}},\n\nI hope this message finds you well. My name is {{Your Name}} from {{Company}}, a manufacturer specializing in {{Product}}. We have been supplying distributors and wholesalers around the world, and we are known for reliable quality, competitive pricing and on-time delivery.\n\nA few reasons importers choose to work with us:\n1. Factory-direct prices with flexible MOQ;\n2. Full customization — branding, packaging and specifications;\n3. Strict quality control with third-party inspection support;\n4. Fast response and dedicated English-speaking support.\n\nMay I send you our latest catalog, samples or a tailored quotation? If you tell me which items you are currently sourcing, I will prepare a proposal that fits your market.\n\nI look forward to your reply.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "reply",
      title: "询盘回复",
      subject: "Re: Your inquiry about {{Product}}",
      body: "Dear {{Customer Name}},\n\nThank you for your inquiry about {{Product}}. We are glad to hear from you, and here is a quick summary of our proposal:\n\n- Product: {{Product}}\n- Unit price: {{Price}}\n- Payment terms: {{Payment Terms}}\n- Delivery time: {{Delivery Time}}\n\nTo prepare an accurate formal quotation, could you please confirm:\n1. Your target quantity and destination port?\n2. Any specific certifications or quality requirements?\n3. Preferred packaging or branding?\n\nWe can also arrange samples for your evaluation before you place an order. Please let me know if you have any questions.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "reply",
      title: "客户嫌价高回复",
      subject: "Re: Pricing for {{Product}}",
      body: "Dear {{Customer Name}},\n\nThank you for your candid feedback on our pricing. I completely understand that price matters, and I would like to explain what is behind our quote of {{Price}}.\n\n- We use quality materials and strict production control to ensure consistent, reliable products;\n- Our price already includes standard packaging, and we are happy to discuss quantity-based adjustments;\n- We offer flexible payment terms ({{Payment Terms}}) and full support before and after shipment.\n\nTo better fit your budget, could you share your target price and expected annual quantity? We can look at adjusting specifications, packaging or order volume to find a solution together.\n\nI am confident we can work something out.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "quote",
      title: "报价跟进",
      subject: "Follow-up on our quotation for {{Product}}",
      body: "Dear {{Customer Name}},\n\nI am writing to follow up on the quotation we sent on {{Quote Date}} for {{Product}}. I hope it has been helpful for your evaluation.\n\nHere is a quick recap:\n- Price: {{Price}}\n- Payment: {{Payment Terms}}\n- Delivery: {{Delivery Time}}\n- Validity: {{Validity}}\n\nWe would be glad to adjust the pricing or specifications to better match your requirements. If useful, we can also send samples so you can check the quality first-hand.\n\nMay I ask how the evaluation is going? I would love to help move this forward.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "payment",
      title: "催款提醒",
      subject: "Payment reminder — Invoice {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nI hope you are doing well. This is a friendly reminder regarding invoice {{Order No.}} in the amount of {{Amount}}, which is due per the agreed terms ({{Payment Terms}}).\n\nTo keep production and shipment on schedule, we would appreciate your prompt settlement. If the payment has already been arranged, please ignore this message and accept our thanks.\n\nIf you have any questions about the invoice or bank details, I am happy to assist.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "ship",
      title: "发货通知",
      subject: "Shipment notification — Order {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nGood news! Your order {{Order No.}} has been shipped on {{Ship Date}}.\n\nShipment details:\n- Carrier / Tracking No.: {{Tracking No.}}\n- Quantity: {{Quantity}}\n- Estimated arrival: {{ETA}}\n\nWe will send the shipping documents (commercial invoice, packing list, and bill of lading / air waybill) shortly. Please feel free to contact us if anything is unclear.\n\nThank you for your trust.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "arrival",
      title: "到货跟进",
      subject: "Follow-up on order {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nWe hope the goods of order {{Order No.}} have arrived in good condition. Please let us know if you have any feedback on quality, packaging or documentation — we take it seriously and will act promptly if anything needs attention.\n\nIf everything is satisfactory, we would be delighted to discuss your next order, and we can offer priority scheduling for returning clients.\n\nLooking forward to your feedback.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "after",
      title: "售后处理",
      subject: "Regarding your report on {{Product}}",
      body: "Dear {{Customer Name}},\n\nThank you for letting us know about the issue with {{Product}}. We sincerely apologize for the inconvenience.\n\nWe are now reviewing the details and will provide a solution by {{Follow-up Date}}. To help us resolve it quickly, could you please share:\n1. Photos or a short video of the issue;\n2. The affected quantity and the batch / lot number, if available.\n\nWe take product quality seriously and will handle this fairly — whether through replacement, repair or another arrangement.\n\nWe appreciate your patience.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "season",
      title: "节日问候",
      subject: "Season's greetings from {{Company}}",
      body: "Dear {{Customer Name}},\n\nWishing you and your team a wonderful {{Holiday}}! Thank you for your continued trust and support throughout the year — it has been a pleasure working with you.\n\nAs we look ahead, if there is anything we can help with — such as new product development, samples or early orders — please feel free to reach out. We would be happy to give you priority attention.\n\nWarm regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "season",
      title: "工厂假期通知",
      subject: "Factory holiday notice — order planning",
      body: "Dear {{Customer Name}},\n\nWe would like to inform you that our factory will be closed from {{Holiday Period}} for the {{Holiday}} holiday. Production and shipping will resume on {{Resume Date}}.\n\nTo avoid any delay, we kindly suggest placing orders or confirming shipments before {{Order Deadline}}. Orders confirmed during the holiday will be scheduled in sequence after we return.\n\nThank you for your understanding, and we wish you a happy {{Holiday}}!\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "sample",
      title: "样品发送",
      subject: "Samples of {{Product}} dispatched",
      body: "Dear {{Customer Name}},\n\nGreat news — the samples of {{Product}} have been prepared and dispatched by {{Courier}}.\n\nSample details:\n- Quantity: {{Quantity}}\n- Tracking No.: {{Tracking No.}}\n- Expected arrival: {{Arrival Date}}\n\nOnce you receive them, please check the quality, finish and packaging. If any adjustment is needed, we can refine the production sample before mass production.\n\nWe look forward to your feedback and to preparing a formal order for you.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "sample",
      title: "认证资料回复",
      subject: "Re: {{Certification}} documents for {{Product}}",
      body: "Dear {{Customer Name}},\n\nThank you for your request. Regarding the {{Certification}} for {{Product}}, we can provide the following documents:\n\n- Test report\n- Certificate copy\n- Declaration of Conformity\n\nIf your market requires additional testing or specific versions of these documents, we can arrange that as well — please let us know the exact requirement.\n\nI will send the documents right away. Please confirm the best email address to receive them.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "order",
      title: "订单确认",
      subject: "Order confirmation — {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nThank you very much for your order! Please find our order confirmation for {{Order No.}} below:\n\n- Product: {{Product}}\n- Quantity: {{Quantity}}\n- Total amount: {{Amount}}\n- Payment terms: {{Payment Terms}}\n- Delivery time: {{Delivery Time}}\n- Destination port: {{Port}}\n\nWe will issue the proforma invoice and begin production once the deposit is received. Please review the confirmation and let us know if any details need to be adjusted.\n\nThank you for your trust — we will keep you updated throughout production.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "order",
      title: "生产进度更新",
      subject: "Production update — Order {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nI would like to give you a quick update on order {{Order No.}}.\n\n- Production status: in progress, expected to complete by {{Delivery Time}}\n- Quantity: {{Quantity}}\n- Product: {{Product}}\n\nEverything is on track, and we will notify you as soon as the goods are ready for shipment. If you have any special packing or labeling requirements, please let us know before production is finished.\n\nThank you for your patience and trust.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "delay",
      title: "交期延期通知",
      subject: "Delivery update — Order {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nWe regret to inform you that the delivery of order {{Order No.}} may be delayed by approximately {{Delay Days}} days due to {{Reason}}.\n\nWe understand this may affect your schedule, and we are doing everything possible to minimize the impact. Production is being prioritized, and we will keep you updated with a revised timeline as soon as it is confirmed.\n\nPlease let us know if this delay causes any difficulty on your side, so we can discuss the best solution together.\n\nWe sincerely apologize for the inconvenience.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "invoice",
      title: "随附商业发票",
      subject: "Commercial invoice & packing list — {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nPlease find attached the commercial invoice and packing list for order {{Order No.}}.\n\nInvoice details:\n- Invoice No.: {{Invoice No.}}\n- Amount: {{Amount}}\n- Payment due: {{Payment Terms}}\n\nIf the payment method is T/T, please arrange the transfer at your earliest convenience and share the remittance advice with us so we can track it. If you have any questions about the documents, do not hesitate to contact me.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "invoice",
      title: "付款收到确认",
      subject: "Payment received — Invoice {{Order No.}}",
      body: "Dear {{Customer Name}},\n\nWe are pleased to confirm that we have received your payment of {{Amount}} for invoice {{Order No.}}.\n\n- Amount received: {{Amount}}\n- Invoice No.: {{Invoice No.}}\n- Order No.: {{Order No.}}\n\nProduction / shipment will now proceed as scheduled. We will keep you informed of the progress and notify you as soon as the goods are dispatched.\n\nThank you for your prompt payment!\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "fair",
      title: "展会邀约",
      subject: "Meet us at {{Fair Name}} — booth {{Booth No.}}",
      body: "Dear {{Customer Name}},\n\nWe are pleased to inform you that {{Company}} will attend {{Fair Name}} from {{Fair Date}} at booth {{Booth No.}}.\n\nWe will be showcasing our latest {{Product}} range, including new models and customized solutions. It would be our great pleasure to meet you there and discuss how we can support your business.\n\nPlease let us know if you plan to attend, and we will arrange a meeting time and prepare samples for you in advance.\n\nLooking forward to seeing you at the fair!\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },
    {
      category: "fair",
      title: "老客户再营销",
      subject: "New products & pricing — a quick update for you",
      body: "Dear {{Customer Name}},\n\nIt has been a while since our last cooperation, and I hope everything is going well with your business.\n\nWe have been busy improving our {{Product}} range, and we now offer new models and more competitive pricing that may suit your market well. Our MOQ has also become more flexible.\n\nCould we send you our updated catalog or a sample? I would be glad to prepare a special quotation for you as a returning client.\n\nWe value our partnership and look forward to working with you again.\n\nBest regards,\n{{Your Name}}\n{{Company}} | {{Email}} | {{Phone}}"
    },],

  docChecklist: {
    sea: [
      { title: "商业发票 Commercial Invoice", desc: "金额、品名、HS 编码、贸易条款必须与报关一致", phase: "制单", owner: "业务员 / 财务", when: "装运前", purpose: "清关、结汇", gen: "ci" },
      { title: "装箱单 Packing List", desc: "箱号、数量、毛净重、体积和唛头信息", phase: "制单", owner: "业务员 / 仓库", when: "装运前", purpose: "清关、核对", gen: "pl" },
      { title: "海运提单 Bill of Lading", desc: "正本 / 电放，注意收货人、通知方和背书", phase: "装运", owner: "货代 / 船公司", when: "装船后", purpose: "物权凭证、提货", gen: "bl" },
      { title: "报关单 Export Declaration", desc: "由报关行申报，保存底单用于退税", phase: "报关", owner: "报关行", when: "装运前", purpose: "出口申报、退税", gen: null },
      { title: "原产地证 Certificate of Origin", desc: "普通 CO 或优惠产地证，按目的国要求", phase: "制单", owner: "业务员 / 贸促会", when: "装运前后", purpose: "关税优惠", gen: "co" },
      { title: "保险单 Insurance Policy", desc: "CIF/CIP 条款必须投保，保额通常为发票金额 110%", phase: "投保", owner: "业务员 / 保险公司", when: "装运前", purpose: "运输风险保障", gen: null },
      { title: "检验证书 Inspection Certificate", desc: "部分市场或信用证要求第三方检验", phase: "验货", owner: "第三方机构", when: "装运前", purpose: "品质证明、信用证", gen: null },
      { title: "装船通知 Shipping Advice", desc: "FOB/CFR 条款应在装船后及时通知买方", phase: "装运", owner: "业务员", when: "装船后", purpose: "通知买方投保、收货", gen: "sa" },
      { title: "受益人证明 Beneficiary Certificate", desc: "信用证要求时按指定措辞出具", phase: "制单", owner: "业务员", when: "信用证项下", purpose: "信用证相符", gen: "bc" }
    ],
    air: [
      { title: "商业发票 Commercial Invoice", desc: "品名与随机清单一致，注明贸易条款", phase: "制单", owner: "业务员 / 财务", when: "装运前", purpose: "清关、结汇", gen: "ci" },
      { title: "装箱单 Packing List", desc: "每件包装的毛净重和尺寸", phase: "制单", owner: "业务员 / 仓库", when: "装运前", purpose: "清关、核对", gen: "pl" },
      { title: "空运单 Air Waybill", desc: "确认收货人、通知人和运费支付方式", phase: "装运", owner: "货代 / 航空公司", when: "交运后", purpose: "运输凭证、提货", gen: "awb" },
      { title: "报关单 Export Declaration", desc: "航空口岸申报，保留退税凭证", phase: "报关", owner: "报关行", when: "交运前", purpose: "出口申报、退税", gen: null },
      { title: "原产地证 Certificate of Origin", desc: "按目的国关税优惠要求办理", phase: "制单", owner: "业务员 / 贸促会", when: "交运前后", purpose: "关税优惠", gen: "co" },
      { title: "保险单 Insurance Policy", desc: "CIP 或客户要求时提供", phase: "投保", owner: "业务员 / 保险公司", when: "交运前", purpose: "运输风险保障", gen: null },
      { title: "检测报告 / MSDS", desc: "危险品或特殊品类需随货资料", phase: "备货", owner: "工厂 / 实验室", when: "交运前", purpose: "合规、航空安全", gen: null }
    ],
    express: [
      { title: "商业发票 Commercial Invoice", desc: "快递清关核心文件，品名申报需真实", phase: "制单", owner: "业务员 / 财务", when: "寄件前", purpose: "清关、申报", gen: "ci" },
      { title: "装箱单 Packing List", desc: "便于快递公司和海关核验", phase: "制单", owner: "业务员 / 仓库", when: "寄件前", purpose: "清关、核对", gen: "pl" },
      { title: "运单 Tracking Label", desc: "确认收件人地址、电话和税号", phase: "寄件", owner: "快递公司", when: "寄件时", purpose: "运输跟踪", gen: null },
      { title: "原产地证 Certificate of Origin", desc: "部分国家清关或关税优惠需要", phase: "制单", owner: "业务员 / 贸促会", when: "寄件前后", purpose: "关税优惠", gen: "co" },
      { title: "授权书 / 报关委托", desc: "个别国家要求收件人或发件人授权", phase: "清关", owner: "收件人 / 发件人", when: "到港后", purpose: "目的国清关", gen: null }
    ]
  }
};

const DEMO_CLIENTS = [
  { id: "c1", name: "Michael Chen", company: "Brightpath Imports", email: "michael@brightpath.com", country: "美国", status: "报价中", nextFollowUp: todayPlus(3), notes: "关注 LED 灯条认证与交期" },
  { id: "c2", name: "Sofia Müller", company: "Nordhaus GmbH", email: "sofia@nordhaus.de", country: "德国", status: "跟进中", nextFollowUp: todayPlus(1), notes: "需要 CE 和 RoHS 证书" },
  { id: "c3", name: "Aisha Rahman", company: "Gulf Trade Co.", email: "aisha@gulftrade.ae", country: "阿联酋", status: "已联系", nextFollowUp: todayPlus(6), notes: "询价 40HQ 整柜" },
  { id: "c4", name: "Kenji Sato", company: "Sakura Enterprise", email: "kenji@sakura.jp", country: "日本", status: "已成交", nextFollowUp: "", notes: "首批 5000 件已发货" }
];

const DEMO_QUOTES = [
  { id: "q1", ref: "QT-20260801", clientId: "c1", clientName: "Brightpath Imports", product: "LED 灯条 5m", unitPrice: 3.85, currency: "USD", qty: 1000, incoterm: "FOB", status: "跟进中", date: "2026-08-01", notes: "含 15% 利润，目标海运" },
  { id: "q2", ref: "QT-20260803", clientId: "c2", clientName: "Nordhaus GmbH", product: "智能插座", unitPrice: 6.2, currency: "EUR", qty: 2000, incoterm: "CIF", status: "新报价", date: "2026-08-03", notes: "客户要求 TUV 认证资料" }
];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
