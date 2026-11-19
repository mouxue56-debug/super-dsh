/* 两份演示数据使用相同读取接口；对象每次复制，保持原字面量的独立性。 */
function demoFixture(key){if(!Object.hasOwn(DEMO_FIXTURES,key))throw Error("缺少演示内容："+key);return JSON.parse(JSON.stringify(DEMO_FIXTURES[key]));}
function demoText(key){if(!Object.hasOwn(DEMO_TEXT,key))throw Error("缺少演示文案："+key);return DEMO_TEXT[key];}
