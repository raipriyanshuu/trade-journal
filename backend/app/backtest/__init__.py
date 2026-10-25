"""Backtesting: bar-replay practice trading, fully separate from the journal.

Everything here lives in its own SQLite file (``data/backtest.db``) with its own
tables and its own candle store. Nothing in the journal (trades, dashboard,
mistakes, reports) reads it, and nothing here writes to ``journal.db``.
"""
