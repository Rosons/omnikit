use std::fmt;

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    /// 密码错误(verify 块校验不通过)
    WrongPassword,
    /// 容器损坏 / 格式不符合预期
    Corrupt(String),
    /// 输出冲突(消息在生成处完整组装,直接透传)
    Conflict(String),
    /// 输入参数不合法
    BadInput(String),
    /// 用户取消
    Cancelled,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(e) => write!(f, "文件读写失败：{e}"),
            Error::WrongPassword => write!(f, "密码错误，或保险箱已损坏"),
            Error::Corrupt(msg) => write!(f, "保险箱文件损坏：{msg}"),
            Error::Conflict(msg) => write!(f, "{msg}"),
            Error::BadInput(msg) => write!(f, "输入不合法：{msg}"),
            Error::Cancelled => write!(f, "已取消"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
