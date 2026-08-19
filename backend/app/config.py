from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://canasta:canasta@localhost:5432/canasta"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173"]
    secret_key: str = "dev-secret-key-change-me"
    bot_move_delay_min_seconds: float = 0.6
    bot_move_delay_max_seconds: float = 2.0


settings = Settings()
