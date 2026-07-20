#!/usr/bin/env python3

import sys

try:
	from PyQt6.QtCore import QEvent
	from PyQt6.QtWidgets import QApplication, QLabel, QLineEdit, QMainWindow, QVBoxLayout, QWidget
except ImportError:
	from PySide6.QtCore import QEvent
	from PySide6.QtWidgets import QApplication, QLabel, QLineEdit, QMainWindow, QVBoxLayout, QWidget


class SmokeInput(QLineEdit):
	def __init__(self, event_label: QLabel, text_label: QLabel) -> None:
		super().__init__()
		self.event_label = event_label
		self.text_label = text_label
		self.setPlaceholderText('请在这里短按或长按空格')
		self.textChanged.connect(self.update_text_label)

	def event(self, event: QEvent) -> bool:
		if event.type() in (QEvent.Type.KeyPress, QEvent.Type.KeyRelease):
			event_name = 'press' if event.type() == QEvent.Type.KeyPress else 'release'
			self.event_label.setText(
				f'最近按键: {event_name}, key={event.key()}, autoRepeat={event.isAutoRepeat()}'
			)
		return super().event(event)

	def update_text_label(self, text: str) -> None:
		self.text_label.setText(f'输入内容: {text!r}，字符数: {len(text)}')


def main() -> int:
	app = QApplication(sys.argv)
	window = QMainWindow()
	window.setWindowTitle('VoxSpell Qt 输入冒烟测试')

	instructions = QLabel(
		'验证步骤：\n'
		'1. 短按空格，应只输入一个空格。\n'
		'2. 长按空格说话，提示窗应保持显示，输入框不应连续增加空格。\n'
		'3. 松开空格，应结束录音并输入识别结果。'
	)
	event_label = QLabel('最近按键: 无')
	text_label = QLabel("输入内容: ''，字符数: 0")
	input_field = SmokeInput(event_label, text_label)

	layout = QVBoxLayout()
	layout.addWidget(instructions)
	layout.addWidget(input_field)
	layout.addWidget(text_label)
	layout.addWidget(event_label)

	content = QWidget()
	content.setLayout(layout)
	window.setCentralWidget(content)
	window.resize(620, 220)
	window.show()
	input_field.setFocus()
	return app.exec()


if __name__ == '__main__':
	raise SystemExit(main())
