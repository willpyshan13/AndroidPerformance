package dev.androidperformance.compiler;

import org.jetbrains.kotlin.ir.expressions.IrStatementOrigin;
import org.jetbrains.kotlin.ir.expressions.impl.IrCallImpl;
import org.jetbrains.kotlin.ir.expressions.impl.IrConstImpl;
import org.jetbrains.kotlin.ir.symbols.IrSimpleFunctionSymbol;
import org.jetbrains.kotlin.ir.types.IrType;
import org.jetbrains.kotlin.ir.util.IrElementConstructorIndicator;

/** Java bridge for IR constructors whose Kotlin metadata marks them as compiler-internal. */
public final class IrCalls {
    private IrCalls() {}

    public static IrCallImpl stringCall(int start, int end, IrType unitType, IrType stringType,
                                        IrSimpleFunctionSymbol function, String argument) {
        IrCallImpl call = new IrCallImpl(IrElementConstructorIndicator.INSTANCE, start, end,
                unitType, (IrStatementOrigin) null, function, null);
        call.putValueArgument(0, IrConstImpl.Companion.string(start, end, stringType, argument));
        return call;
    }
}
