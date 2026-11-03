# Kindle 时钟和天气预报

原理：利用 Kindle 的内置浏览器 访问 H5 页面

注：参考原作：https://github.com/0111/Kindle_WeatherCN

手里是一台 7 代的 Kindle，在显示原作时页面有些超出屏幕范围，因此手动改造了一版。

相对原作主要改动如下：

- 大幅修改了 kindle.css，去掉了所有定位布局系统，换成了 webkit 版的 flexbox（老 kindle 内置浏览器不支持现代 flexbox）；
- 重新制作了字体，基于阿里巴巴普惠体，工具和方法放在./fontTool；
- 修改了日期、城市和当前天气的显示；
- network.js，天气缓存、15 秒超时、失败退避重试、独立 JSONP 回调；校时成功后每 6 小时同步；
- 接入新的请求逻辑、校验天气数据；时钟和日期独立更新，天气失败也能继续走

## 第一步：关闭屏幕休眠模式

最新的 kindle 系统已经无法在搜索框中输入： ～ ds 来关闭屏保，必须越狱。

- 安装 WinterBreak
- 安装 KUAL 和 KUAL Helper

操作参考：

- https://bookfere.com/post/406.html
- https://bookfere.com/post/1145.html
- https://bookfere.com/post/311.html
- https://bookfere.com/post/477.html

## 第二步：用 Kindle 浏览器打开时钟

访问页面：[Kindle 时钟和天气预报](https://linlinw5.github.io/kindle_clock/)。可以将此地址加入 Kindle 浏览器书签。

点击页面右上角的城市名称进入配置页，可设置城市、时区、温度单位，以及自己的 OpenWeather Appid-Key。

## 备注

config.js 中 cityNameDB 收录了 60 多个知名城市，如果自己所在的城市未列入，则右上角会显示拼音，可以自行添加自己城市的中文名到 cityNameDB。

## 效果图

![Kindle7代](./docs/kindle.jpg)

![竖屏](./docs/竖屏.png)

![横屏](./docs/横屏.png)
