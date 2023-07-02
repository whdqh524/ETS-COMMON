'use strict';

class EtsError extends Error{
    constructor (lastError) {
        super();
        if(lastError) {
            if(lastError instanceof Error || typeof lastError == 'object'){
                this.lastError = lastError;
            }else{
                this.desc = lastError;
            }
        }else{
            this.desc = '-';
        }
    }
}
exports.EtsError = EtsError;

class EtsErrorWithParams extends EtsError {
    constructor(descStr, ...args) {
        super();
        if(args.length > 0) {
            this.params = args;
            this.desc = `${descStr} - ${args.join(',')}`;
        }else{
            this.desc = `${descStr}`;
        }
    }
}

class EtsErrorWithoutLogging extends EtsError {
    constructor(...args) {
        super(...args);
    }
}
exports.EtsErrorWithoutLogging = EtsErrorWithoutLogging;

exports.ParameterError = class ParameterError extends EtsErrorWithParams {
    constructor (...args) {
        super(`Not input parameter`, ...args);
        this.code = 'NONE_PARAMETER';
    }
};

exports.NotFindUserError = class NotFindUserError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_BUTLER_USER';
    }
};


exports.AuthTokenExpiredError = class AuthTokenExpiredError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'TOKEN_EXPIRATION';
    }
};

exports.InvalidPasswordError = class InvalidPasswordError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_CORRESPOND_PW';
    }
};

exports.UserNameAlreadyRegisteredError = class UserNameAlreadyRegisteredError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'ACCOUNT_INUSE';
    }
};

exports.UserEmailAlreadyRegisteredError = class UserEmailAlreadyRegisteredError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'INVALID_EMAIL';
    }
};

exports.NeedUserEmailVerifyError = class NeedUserEmailVerifyError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = '-';
    }
};

exports.ExpireEmailCodeError = class ExpireEmailCodeError extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'INVALID_CODE'
    }
};

exports.InvalidEmailCodeError = class InvalidEmailCodeError extends EtsErrorWithoutLogging {
    constructor (lastError) {
        super(lastError);
        this.code = 'REGIST_INVALID_EMAILCODE';
    }
};

exports.NeedGoogleOTPVerifyError = class NeedGoogleOTPVerifyError extends EtsErrorWithoutLogging{
    constructor(lastError) {
        super(lastError);
        this.code = '-';
    }
};

exports.ExpireGoogleOTPTokenError = class ExpireGoogleOTPTokenError extends EtsErrorWithoutLogging {
    constructor (lastError) {
        super(lastError);
        this.code = 'INVALID_CODE';
    }
};

exports.InvalidGoogleOTPTokenError = class InvalidGoogleOTPTokenError extends EtsErrorWithoutLogging {
    constructor (lastError) {
        super(lastError);
        this.code = 'LOGIN_INVALID_GOOGLECODE';
    }
};

exports.InvalidCheckPassword = class InvalidCheckPassword extends EtsErrorWithoutLogging {
    constructor(lastError) {
        super(lastError);
        this.code = 'MY_INFORMATION_NOT_CONFIRM_PW';
    }
};


exports.DatabaseError = class DatabaseError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SERVER_DATABASE_ERROR';
    }
};

exports.RedisError = class RedisError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SERVER_REDIS_ERROR';
    }
};

exports.AxiosError = class AxiosError extends  EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SERVER_AXOS_ERROR';
    }
};

exports.AlreadyOngoingStrategyError = class AlreadyOngoingStrategyError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'ONORDER_STRATEGY_DELETE';
    }
};

exports.ApiKeyAlreadyRegisterError = class ApiKeyAlreadyRegisterError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'API_MANAGEMENT_ALREADY_REGISTERED';
    }
};

exports.ApiKeyIsAliveError = class ApiKeyIsAliveError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_AVAILABLE_DELETE_APIKEY';
    }
};

exports.NotInputExchangeApiKeyError = class NotInputExchangeApiKeyError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'NONE_API_RUNORDER';
    }
};

class ExchangeServerRequestTimeOutError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SERVER_REQUEST_ERROR';
    }
}
exports.ExchangeServerRequestTimeOutError = ExchangeServerRequestTimeOutError;

class ExchangeServerInternalError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SERVER_INTERNAL_ERROR';
    }
}
exports.ExchangeServerInternalError = ExchangeServerInternalError;

exports.TelegramIDNotFoundError = class TelegramIDNotFoundError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_FOUND_TELEGRAMID'
    }
};

exports.TelegramIDNotStartedError = class TelegramIDNotStartedError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_STARTED_TELEGRAMID'
    }
};

exports.TelegramServerError = class TelegramServerError extends EtsError {
    constructor (lastError) {
        super(lastError);
    }
};


exports.TelegramServerRequestTimeOutError = class TelegramServerRequestTimeOutError extends EtsError {
    constructor (lastError) {
        super(lastError);
    }
};


exports.OrderPlanNotExistError = class OrderPlanNotExistError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'ORDERPLAN_ID_NOT_EXIST';
    }
};

exports.SubOrderNotExistError = class SubOrderNotExistError extends EtsError {
    constructor (lastError) {
        super(lastError);
        this.code = 'SUB_ORDER_NOT_EXIST';
    }
};


exports.NotOpenFilledActionError = class NotOpenFilledActionError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'OPEN_NOT_FILLED_ACTION';
    }
};


exports.NotAllowedCompletedOrderError = class NotAllowedCompletedOrderError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'COMPLETED_ORDER_ACTION';
    }
};

exports.ResumeActionOnlyPauseActiveError = class ResumeActionOnlyPauseActiveError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'RESUME_ACTION_ONLY_PAUSE';
    }
};
exports.PauseActionOnlyActiveOrderError = class PauseActionOnlyActiveOrderError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'PAUSE_ACTION_ONLY_ACTIVE_ORDER';
    }
};

exports.NotAllowedPlanTypeForApiError = class NotAllowedPlanTypeForApiError extends EtsError{
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_USE_ORDER_FUNCTION';
    }
};

exports.NotAllowedVirtualBasicOrderError = class NotAllowedVirtualBasicOrderError extends EtsError{
    constructor(lastError) {
        super(lastError);
        this.code = 'VIRTUAL_DISABLE_BASIC';
    }

};

exports.OrderCountRestrictionError = class OrderCountRestrictionError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'MAX_ORDER_15';
    }
};

exports.StrategyCountRestrictionError = class StrategyCountRestrictionError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'MAX_STRATEGY_15';
    }
};

exports.EnterPriceTickSizeInvalidError = class EnterPriceTickSizeInvalidError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'INVALID_INDICATOR_TICKSIZE';
    }
};


exports.StrategyNotExistError = class StrategyNotExistError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'NONE_STRATEGY_MODEL';
    }
};

exports.WrongDirectionError = class WrongDirectionError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'WRONG_DIRECTION';
    }
};

exports.BasicOrderOpenFilledActionError = class BasicOrderOpenFilledActionError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'NOT_ACTION_BASIC_FILLED';
    }
};

exports.TooManySameRequestError = class TooManySameRequestError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = '';
    }
};

exports.SlackRequestError = class SlackRequestError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = '';
    }
};

exports.NotFoundError404 = class NotFoundError404 extends EtsErrorWithoutLogging {
  constructor(lastError) {
      super(lastError);
  }
};

exports.InvalidTelegramIDError = class InvalidTelegramIDError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'INVALID_TELEGRAM_ID'
    }
};

exports.AlreadySignOutAccountError = class AlreadySignOutAccountError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'ACCOUNT_SIGNOUT';
    }
};

exports.IndicatorValidationError = class IndicatorValidationError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'INVALID_INDICATOR_STRATEGY';
    }
};

exports.NeedCheckApiKeyError = class NeedCheckApiKeyError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'CHECK_APIKEY'
    }
};

exports.BlockedAccountError = class BlockedAccountError extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'ACCOUNT_BLOCK';
    }
};

exports.ClearingBatchSellFailed = class ClearingBatchSellFailed extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'BATCH_SELL_FAILED';
    }
};

exports.FavoriteLimitExceed = class FavoriteLimitExceed extends EtsError {
    constructor(lastError) {
        super(lastError);
        this.code = 'FAVORITE_LIMIT_EXCEED ';
    }
};



