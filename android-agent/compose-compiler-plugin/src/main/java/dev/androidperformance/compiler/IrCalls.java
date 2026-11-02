package dev.androidperformance.compiler;

import org.jetbrains.kotlin.ir.expressions.IrStatementOrigin;
import org.jetbrains.kotlin.ir.expressions.IrBranch;
import org.jetbrains.kotlin.ir.expressions.IrContainerExpression;
import org.jetbrains.kotlin.ir.expressions.impl.IrCallImpl;
import org.jetbrains.kotlin.ir.expressions.impl.IrConstImpl;
import org.jetbrains.kotlin.ir.expressions.impl.IrBlockImpl;
import org.jetbrains.kotlin.ir.IrStatement;
import org.jetbrains.kotlin.ir.expressions.IrExpression;
import org.jetbrains.kotlin.ir.expressions.IrConst;
import org.jetbrains.kotlin.ir.expressions.IrCall;
import org.jetbrains.kotlin.ir.symbols.IrSimpleFunctionSymbol;
import org.jetbrains.kotlin.ir.types.IrType;
import org.jetbrains.kotlin.ir.util.IrElementConstructorIndicator;
import java.lang.reflect.Method;

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

    public static IrCallImpl unitCall(int start, int end, IrType unitType, IrSimpleFunctionSymbol function) {
        return new IrCallImpl(IrElementConstructorIndicator.INSTANCE, start, end,
                unitType, (IrStatementOrigin) null, function, null);
    }

    public static IrCallImpl stringIntCall(int start, int end, IrType unitType, IrType stringType, IrType intType,
                                           IrSimpleFunctionSymbol function, String stringArgument, int intArgument) {
        IrCallImpl call = stringCall(start, end, unitType, stringType, function, stringArgument);
        try {
            Method factory = IrConstImpl.Companion.getClass().getMethod("int", int.class, int.class, IrType.class, int.class);
            call.putValueArgument(1, (IrExpression)factory.invoke(IrConstImpl.Companion, start, end, intType, intArgument));
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Cannot create Compose group key constant", error);
        }
        return call;
    }

    public static Integer intConstValue(IrExpression expression) {
        if (!(expression instanceof IrConst)) return null;
        Object value = ((IrConst) expression).getValue();
        return value instanceof Integer ? (Integer) value : null;
    }

    public static IrExpression firstValueArgument(IrCall call) {
        return call.getValueArgument(0);
    }

    public static void prependToBranch(IrBranch branch, IrStatement statement) {
        IrExpression result = branch.getResult();
        if (result instanceof IrContainerExpression) {
            ((IrContainerExpression) result).getStatements().add(0, statement);
            return;
        }
        IrBlockImpl block = new IrBlockImpl(IrElementConstructorIndicator.INSTANCE,
                result.getStartOffset(), result.getEndOffset(), result.getType(), (IrStatementOrigin) null);
        block.getStatements().add(statement);
        block.getStatements().add(result);
        branch.setResult(block);
    }
}
