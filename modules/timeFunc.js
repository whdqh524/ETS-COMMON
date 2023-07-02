'use strict';

function twoDigits(d) {
    if(0 <= d && d < 10) return "0" + d.toString();
    if(-10 < d && d < 0) return "-0" + (-1*d).toString();
    return d.toString();
}
function lpad(value, padding) {
    let zeroes = new Array(padding+1).join("0");
    return (zeroes + value).slice(-padding);
}
Date.prototype.toMysqlFormat = function() {
    return `${this.getFullYear()}-${twoDigits(1+this.getMonth())}-${twoDigits(this.getDate())} ${twoDigits(this.getHours())}:${twoDigits(this.getMinutes())}:${twoDigits(this.getSeconds())}:${lpad(this.getMilliseconds(),3)}`
};
Date.prototype.toBirthFormat = function() {
    return `${this.getFullYear()}-${twoDigits(1+this.getMonth())}-${twoDigits(this.getDate())}`;
};
Date.prototype.nowTime = function() {
    return `${this.getFullYear()}-${twoDigits(1+this.getMonth())}-${twoDigits(this.getDate())} ${twoDigits(this.getHours())}:${twoDigits(this.getMinutes())}:${twoDigits(this.getSeconds())}`;
};
String.prototype.toTitleCase = function () {return this.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});};