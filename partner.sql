/*
 Navicat Premium Data Transfer

 Source Server         : master-1
 Source Server Type    : MariaDB
 Source Server Version : 100114
 Source Host           : localhost
 Source Database       : partner

 Target Server Type    : MariaDB
 Target Server Version : 100114
 File Encoding         : utf-8

 Date: 08/03/2016 15:33:14 PM
*/

SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
--  Table structure for `actions`
-- ----------------------------
DROP TABLE IF EXISTS `actions`;
CREATE TABLE `actions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) unsigned DEFAULT '0' COMMENT 'id юзера, совершившего действие',
  `asset_id` int(11) NOT NULL COMMENT 'id актива, к которому принадлежит эта запись истории действий.',
  `action_type` enum('SEND_PAYMENT','GET_PAYMENT','SET_SALDO','SEND_INCOMING_PAYMENT_REQUEST','SEND_OUTGOING_PAYMENT_REQUEST','GET_OUTGOING_PAYMENT_REQUEST','GET_INCOMING_PAYMENT_REQUEST','SEND_SET_SALDO_REQUEST','GET_SET_SALDO_REQUEST') NOT NULL COMMENT 'Указывает тип выполненного действия. По нему можно делать выборку списка действий для того или иного актива юзера, а так же он указывает само действие, которое было выполнено.',
  `asset_type` enum('asset','partner','cost_category') NOT NULL COMMENT 'Указывает тип актива.',
  `from_id` int(11) DEFAULT NULL,
  `to_id` int(11) DEFAULT NULL,
  `payment_sum` int(11) DEFAULT NULL COMMENT 'размер суммы, которая будет переведена получателю, при подтверждении перевода. ТОЛЬКО для переводов партнеру.',
  `status` enum('','OK','CANCEL','PENDING','ACCEPT','DECLINE') DEFAULT NULL COMMENT 'Для разных типов действий могут быть разные списки статусов. К примеру, для переводов актив->партнер это "PENDING", "ACCEPT", "DECLINE". Аналогично для сальдо. Для "локальных"(только для самого пользователя) действий статус может быть не указан.',
  `is_visible` tinyint(4) NOT NULL DEFAULT '1' COMMENT 'Для действия по активу.',
  `hash` varchar(40) DEFAULT NULL COMMENT 'Используется для быстрого нахождения всех записей действий над активами, при подтверждении или отклонении переводов(или установок сальдо).',
  `comment` text COMMENT 'Поле для комментария к переводу.',
  `old_saldo` int(11) DEFAULT NULL COMMENT 'Используется для хранения старого значения сальдо (для установки нового общего сальдо, и отмены такой установки).',
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `asset_id` (`asset_id`),
  KEY `action_type` (`action_type`),
  KEY `asset_type` (`asset_type`),
  KEY `status` (`status`),
  KEY `hash` (`hash`)
) ENGINE=InnoDB AUTO_INCREMENT=4289 DEFAULT CHARSET=utf8;

-- ----------------------------
--  Table structure for `assets`
-- ----------------------------
DROP TABLE IF EXISTS `assets`;
CREATE TABLE `assets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL COMMENT 'пользователь, которому принадлежит актив',
  `name` text NOT NULL,
  `saldo` int(11) NOT NULL DEFAULT '0' COMMENT 'текущее состояние баланса данного актива',
  `unconfirmed_incoming_deals` int(11) NOT NULL DEFAULT '0' COMMENT 'количество неподтвержденных входящих сделок по данному активу (ТОЛЬКО когда актив является партнером!)',
  `unconfirmed_outgoing_deals` int(11) NOT NULL DEFAULT '0' COMMENT 'количество неподтвержденных исходящих сделок по данному активу (ТОЛЬКО когда актив является партнером!)',
  `asset_id_in_partner` int(11) DEFAULT NULL COMMENT 'id актива партнера, который соответствует текущему активу-партнеру данного юзера. ТОЛЬКО для актива типа "партнер"',
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `type` enum('asset','partner','cost') DEFAULT 'asset',
  `partner_phone` varchar(20) DEFAULT NULL COMMENT 'номер телефона партнера, с которым связан данный актив(ТОЛЬКО когда актив является партнером!)',
  `is_visible` tinyint(4) DEFAULT '1' COMMENT 'для партнера. если партнер удален, то он становится не видимым, а не удаляется.',
  `is_cost` tinyint(4) DEFAULT '0' COMMENT 'Определяет, относится ли это к экрану "баланс" или к экрану "расходы". 0 - баланс, 1 - расходы.',
  `was_declined` tinyint(4) DEFAULT '0' COMMENT 'Индикатор наличия отклоненной сделки.',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `partner_phone` (`partner_phone`),
  KEY `asset_id_in_partner` (`asset_id_in_partner`),
  KEY `type` (`type`)
) ENGINE=InnoDB AUTO_INCREMENT=545 DEFAULT CHARSET=utf8;

-- ----------------------------
--  Table structure for `messages`
-- ----------------------------
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id_from` int(11) NOT NULL COMMENT 'от кого',
  `user_id_to` int(11) NOT NULL COMMENT 'кому',
  `type` enum('text','image') NOT NULL DEFAULT 'text',
  `text` text NOT NULL COMMENT 'сообщение',
  `viewed` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'просмотрено',
  `active_from` tinyint(1) NOT NULL DEFAULT '1' COMMENT '0-сообщение удалено',
  `active_to` tinyint(1) NOT NULL DEFAULT '1' COMMENT '0-сообщение удалено',
  `inserted` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'дата время отправки',
  PRIMARY KEY (`id`),
  KEY `id_user_from` (`user_id_from`),
  KEY `id_user_to` (`user_id_to`),
  KEY `inserted` (`inserted`),
  KEY `viewed` (`viewed`),
  KEY `id_user_to_2` (`user_id_to`,`viewed`),
  KEY `user_id_from` (`user_id_from`,`user_id_to`),
  KEY `type` (`type`)
) ENGINE=InnoDB AUTO_INCREMENT=91 DEFAULT CHARSET=utf8;

-- ----------------------------
--  Table structure for `users`
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) NOT NULL,
  `name` text,
  `address` text COMMENT 'Юр. адрес',
  `business` varchar(50) DEFAULT NULL COMMENT 'Вид деятельности',
  `position` varchar(50) DEFAULT NULL COMMENT 'Занимаемая должность',
  `requisites` text COMMENT 'Платежные и др. реквизиты',
  `goods` text,
  `password` varchar(32) DEFAULT NULL,
  `token` varchar(64) DEFAULT NULL,
  `pushToken` text,
  `last_message_id` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `phone` (`phone`),
  KEY `token` (`token`),
  KEY `last_message_id` (`last_message_id`)
) ENGINE=InnoDB AUTO_INCREMENT=50 DEFAULT CHARSET=utf8;

SET FOREIGN_KEY_CHECKS = 1;
