import java.util.function.Function;
public class TestRec {
    public static void main(String[] args) {
        class Scope {
            Function<Integer, Integer> fact;
            Scope() {
                fact = (n) -> n <= 1 ? 1 : n * fact.apply(n - 1);
            }
        }
        Scope s = new Scope();
        System.out.println(s.fact.apply(5));
    }
}
