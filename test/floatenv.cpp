#include <nan.h>
#include <cfenv>
#include <sstream>

using namespace Nan;

#pragma STDC FENV_ACCESS ON

NAN_METHOD(GetRoundingMode) {
  info.GetReturnValue().Set(fegetround());
}

NAN_METHOD(SetRoundingMode) {
  Maybe<int> inp = To<int>(info[0]);
  if (inp.IsNothing()) {
    ThrowError("didn't supply a mode");
  } else {
    int mode = inp.FromJust();
    int err = fesetround(mode);
    if (err) {
      std::ostringstream oss;
      oss << "rounding mode " << mode << " invalid (got error code " << err
          << ")";
      ThrowError(oss.str().c_str());
    }
  }
  info.GetReturnValue().SetUndefined();
}

NAN_MODULE_INIT(Init) {
  Set(target, New<v8::String>("getRoundingMode").ToLocalChecked(),
      GetFunction(New<v8::FunctionTemplate>(GetRoundingMode)).ToLocalChecked());
  Set(target, New<v8::String>("setRoundingMode").ToLocalChecked(),
      GetFunction(New<v8::FunctionTemplate>(SetRoundingMode)).ToLocalChecked());
  Set(target, New<v8::String>("ROUND_TONEAREST").ToLocalChecked(),
      New<v8::Int32>(FE_TONEAREST));
  Set(target, New<v8::String>("ROUND_TOWARDZERO").ToLocalChecked(),
      New<v8::Int32>(FE_TOWARDZERO));
  Set(target, New<v8::String>("ROUND_DOWNWARD").ToLocalChecked(),
      New<v8::Int32>(FE_DOWNWARD));
  Set(target, New<v8::String>("ROUND_UPWARD").ToLocalChecked(),
      New<v8::Int32>(FE_UPWARD));
}

NODE_MODULE(returnundefined, Init)
